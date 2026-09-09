import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

async function updateGarments(base44: any, garments: any[], status: string, eventType: string, user: any, job: any, assetIds: string[], requestId: string) {
  const now = new Date().toISOString();
  const updated = [];
  for (const garment of garments) {
    const item = await base44.asServiceRole.entities.GarmentItem.update(garment.id, {
      status,
      location_label: status === 'with_third_party' ? `Terceiro: ${job.code}` : 'Controle de qualidade',
    });
    await base44.asServiceRole.entities.GarmentEvent.create({
      garment_item_id: garment.id,
      order_id: garment.order_id,
      unit_id: garment.unit_id,
      event_type: eventType,
      from_status: garment.status,
      to_status: status,
      operator_user_id: user.id,
      operator_name: user.full_name || user.display_name,
      reason: `third_party_job:${job.id}`,
      asset_ids: assetIds,
      occurred_at: now,
      request_id: requestId,
    });
    updated.push(item);
  }
  return updated;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'manage_third_party_job' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role) && !(user.permissions || []).includes('third_party.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const action = body.action;

    if (action === 'create') {
      const unitId = body.unit_id || user.primary_unit_id;
      if (!canAccessUnit(user, unitId)) return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      if (!body.partner_id || !Array.isArray(body.garment_item_ids) || body.garment_item_ids.length === 0) {
        return Response.json({ error: 'partner_and_garments_required', request_id: requestId }, { status: 422 });
      }

      const garments = [];
      for (const garmentId of body.garment_item_ids) {
        const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentId);
        if (!garment || garment.unit_id !== unitId) return Response.json({ error: 'invalid_garment', request_id: requestId }, { status: 422 });
        garments.push(garment);
      }

      const job = await base44.asServiceRole.entities.ThirdPartyJob.create({
        unit_id: unitId,
        partner_id: body.partner_id,
        code: `TER-${Date.now().toString(36).toUpperCase()}`,
        status: 'draft',
        garment_item_ids: garments.map((garment: any) => garment.id),
        service_description: body.service_description || '',
        estimated_cost: Number(body.estimated_cost || 0),
        expected_return_at: body.expected_return_at,
        notes: body.notes || '',
        request_id: requestId,
      });
      return Response.json({ third_party_job: job, request_id: requestId });
    }

    const jobId = body.third_party_job_id;
    if (!jobId || !['send', 'receive', 'complete', 'cancel'].includes(action)) {
      return Response.json({ error: 'invalid_third_party_action', request_id: requestId }, { status: 400 });
    }
    const job = await base44.asServiceRole.entities.ThirdPartyJob.get(jobId);
    if (!job || !canAccessUnit(user, job.unit_id)) return Response.json({ error: 'third_party_job_not_found', request_id: requestId }, { status: 404 });

    const garments = [];
    for (const garmentId of job.garment_item_ids || []) {
      garments.push(await base44.asServiceRole.entities.GarmentItem.get(garmentId));
    }
    const now = new Date().toISOString();
    let updatedJob = job;
    let updatedGarments = [];
    let accountsPayable = null;

    if (action === 'send') {
      if (!['draft', 'approved'].includes(job.status)) return Response.json({ error: 'job_not_sendable', request_id: requestId }, { status: 409 });
      if (!(body.outbound_asset_ids || []).length) return Response.json({ error: 'outbound_evidence_required', request_id: requestId }, { status: 422 });
      updatedJob = await base44.asServiceRole.entities.ThirdPartyJob.update(job.id, {
        status: 'sent',
        sent_at: now,
        sent_by_user_id: user.id,
        approved_by_user_id: user.id,
        outbound_asset_ids: body.outbound_asset_ids,
      });
      updatedGarments = await updateGarments(base44, garments, 'with_third_party', 'sent_to_third_party', user, job, body.outbound_asset_ids, requestId);
    }

    if (action === 'receive') {
      if (!['sent', 'in_progress'].includes(job.status)) return Response.json({ error: 'job_not_receivable', request_id: requestId }, { status: 409 });
      if (!(body.return_asset_ids || []).length) return Response.json({ error: 'return_evidence_required', request_id: requestId }, { status: 422 });
      updatedJob = await base44.asServiceRole.entities.ThirdPartyJob.update(job.id, {
        status: 'quality_control',
        returned_at: now,
        received_by_user_id: user.id,
        return_asset_ids: body.return_asset_ids,
        actual_cost: Number(body.actual_cost ?? job.actual_cost ?? job.estimated_cost ?? 0),
      });
      updatedGarments = await updateGarments(base44, garments, 'quality_control', 'returned_from_third_party', user, job, body.return_asset_ids, requestId);
    }

    if (action === 'complete') {
      if (job.status !== 'quality_control') return Response.json({ error: 'quality_control_required', request_id: requestId }, { status: 409 });
      for (const garment of garments) {
        const inspections = await base44.asServiceRole.entities.QualityInspection.filter({ garment_item_id: garment.id }, '-inspected_at', 1);
        if (!inspections[0] || !['approved', 'approved_with_observation'].includes(inspections[0].status)) {
          return Response.json({ error: 'approved_quality_inspection_required', garment_item_id: garment.id, request_id: requestId }, { status: 409 });
        }
      }
      updatedJob = await base44.asServiceRole.entities.ThirdPartyJob.update(job.id, { status: 'completed', completed_at: now });
      const amount = Number(job.actual_cost || job.estimated_cost || 0);
      if (amount > 0 && !job.accounts_payable_id) {
        const partner = await base44.asServiceRole.entities.ThirdPartyPartner.get(job.partner_id);
        accountsPayable = await base44.asServiceRole.entities.AccountsPayable.create({
          unit_id: job.unit_id,
          supplier_name: partner?.trade_name || partner?.corporate_name || 'Prestador terceirizado',
          description: `Serviço terceirizado ${job.code}`,
          category: 'Serviços de terceiros',
          cost_center: 'Produção',
          competence_date: now,
          issue_date: now,
          due_date: body.due_date || now,
          original_amount: amount,
          open_amount: amount,
          paid_amount: 0,
          status: 'pending_approval',
          approval_status: 'pending',
          document_asset_ids: job.return_asset_ids || [],
          metadata: { third_party_job_id: job.id, request_id: requestId },
        });
        updatedJob = await base44.asServiceRole.entities.ThirdPartyJob.update(job.id, { accounts_payable_id: accountsPayable.id });
      }
    }

    if (action === 'cancel') {
      if (!String(body.reason || '').trim()) return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
      updatedJob = await base44.asServiceRole.entities.ThirdPartyJob.update(job.id, {
        status: 'cancelled',
        notes: [job.notes, body.reason].filter(Boolean).join('\n'),
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: action === 'cancel' ? 'cancel' : 'status_change',
      entity_type: 'third_party_job', entity_id: job.id, item_label: job.code,
      amount: Number(updatedJob.actual_cost || updatedJob.estimated_cost || 0), reason: `third_party_${action}`,
      user_email: user.email, user_name: user.full_name || user.display_name, user_role: user.role,
      unit_id: job.unit_id, request_id: requestId, before_data: { status: job.status }, after_data: { status: updatedJob.status, accounts_payable_id: accountsPayable?.id }, success: true,
    });

    return Response.json({ third_party_job: updatedJob, garments: updatedGarments, accounts_payable: accountsPayable, request_id: requestId });
  } catch (error) {
    console.error(`[manage_third_party_job:${requestId}]`, error);
    return Response.json({ error: 'third_party_operation_failed', request_id: requestId }, { status: 500 });
  }
});
