import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'production']);

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'inspect_garment_quality' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'production') && !(user.permissions || []).includes('quality.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const body = await req.json();
    const garmentId = body.garment_item_id;
    if (!garmentId || !['approved', 'approved_with_observation', 'rejected'].includes(body.status)) {
      return Response.json({ error: 'garment_and_decision_required', request_id: requestId }, { status: 400 });
    }

    const garment = await base44.asServiceRole.entities.GarmentItem.get(garmentId);
    if (!garment || !canAccessUnit(user, garment.unit_id)) return Response.json({ error: 'garment_not_found', request_id: requestId }, { status: 404 });

    const checklist = Array.isArray(body.checklist) ? body.checklist : [];
    const failures = checklist.filter((item: any) => item.result === 'fail');
    if (body.status === 'rejected' && failures.length === 0 && !(body.defect_codes || []).length) {
      return Response.json({ error: 'defect_required_for_rejection', request_id: requestId }, { status: 422 });
    }

    const now = new Date().toISOString();
    const inspection = await base44.asServiceRole.entities.QualityInspection.create({
      unit_id: garment.unit_id,
      garment_item_id: garment.id,
      order_id: garment.order_id,
      inspection_type: body.inspection_type || 'final',
      status: body.status,
      checklist,
      defect_codes: body.defect_codes || failures.map((item: any) => item.code),
      severity: body.severity || (body.status === 'rejected' ? 'major' : 'none'),
      asset_ids: body.asset_ids || [],
      inspector_user_id: user.id,
      inspector_name: user.full_name || user.display_name,
      inspected_at: now,
      notes: body.notes || '',
      request_id: requestId,
    });

    let rework = null;
    if (body.status === 'rejected') {
      rework = await base44.asServiceRole.entities.ReworkCase.create({
        unit_id: garment.unit_id,
        garment_item_id: garment.id,
        order_id: garment.order_id,
        quality_inspection_id: inspection.id,
        status: 'open',
        reason_code: body.reason_code || failures[0]?.code || 'quality_failure',
        description: body.notes || failures.map((item: any) => item.label).join(', ') || 'Peça reprovada no controle de qualidade',
        responsible_team: body.responsible_team || 'production',
        responsible_user_id: body.responsible_user_id,
        priority: body.severity === 'critical' ? 'critical' : 'high',
        estimated_cost: Number(body.estimated_cost || 0),
        opened_at: now,
        due_at: body.due_at,
        opened_by_user_id: user.id,
        before_asset_ids: body.asset_ids || [],
        customer_impact: body.customer_impact || 'delay',
        request_id: requestId,
      });
      await base44.asServiceRole.entities.QualityInspection.update(inspection.id, { rework_case_id: rework.id });
    }

    const targetStatus = body.status === 'rejected' ? 'rework' : 'ready';
    let updatedGarment = null;
    try {
      const statusResponse = await base44.functions.invoke('update_garment_status', {
        garment_item_id: garment.id,
        status: targetStatus,
        reason: body.status === 'rejected' ? `quality_rejected:${rework?.id}` : 'quality_approved',
        notes: body.notes || '',
        asset_ids: body.asset_ids || [],
      });
      updatedGarment = statusResponse?.data?.garment;
    } catch (_) {
      updatedGarment = await base44.asServiceRole.entities.GarmentItem.update(garment.id, {
        status: targetStatus,
        ready_at: targetStatus === 'ready' ? now : undefined,
      });
      await base44.asServiceRole.entities.GarmentEvent.create({
        garment_item_id: garment.id,
        order_id: garment.order_id,
        unit_id: garment.unit_id,
        event_type: body.status === 'rejected' ? 'rework_opened' : 'quality_checked',
        from_status: garment.status,
        to_status: targetStatus,
        operator_user_id: user.id,
        operator_name: user.full_name || user.display_name,
        reason: body.status === 'rejected' ? `quality_rejected:${rework?.id}` : 'quality_approved',
        asset_ids: body.asset_ids || [],
        occurred_at: now,
        request_id: requestId,
      });
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: body.status === 'rejected' ? 'reject' : 'approve',
      entity_type: 'quality_inspection',
      entity_id: inspection.id,
      item_label: garment.garment_code,
      reason: body.status === 'rejected' ? 'quality_rejected_rework_opened' : 'quality_approved',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: garment.unit_id,
      request_id: requestId,
      after_data: { garment_status: targetStatus, rework_case_id: rework?.id },
      success: true,
    });

    return Response.json({ inspection, rework_case: rework, garment: updatedGarment, request_id: requestId });
  } catch (error) {
    console.error(`[inspect_garment_quality:${requestId}]`, error);
    return Response.json({ error: 'quality_inspection_failed', request_id: requestId }, { status: 500 });
  }
});
