import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const REVIEW_ROLES: Record<string, string[]> = {
  garment_recognition: ['super_admin', 'admin', 'manager', 'attendant'],
  purchase_document: ['super_admin', 'admin', 'manager', 'inventory', 'finance'],
  financial_document: ['super_admin', 'admin', 'manager', 'finance'],
  payment_receipt: ['super_admin', 'admin', 'manager', 'finance', 'cashier'],
  stock_divergence: ['super_admin', 'admin', 'manager', 'inventory'],
  quality_exception: ['super_admin', 'admin', 'manager', 'production'],
  other: ['super_admin', 'admin', 'manager'],
};

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
    await enforceExistingUserSecurity(base44, req, user, { source: 'resolve_human_review' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });

    const { review_id: reviewId, action, corrected_data: correctedData = {}, reason } = await req.json();
    if (!reviewId || !['approve', 'correct', 'reject'].includes(action)) {
      return Response.json({ error: 'invalid_review_action', request_id: requestId }, { status: 400 });
    }
    if (action !== 'approve' && !String(reason || '').trim()) {
      return Response.json({ error: 'reason_required', request_id: requestId }, { status: 422 });
    }

    const review = await base44.asServiceRole.entities.HumanReview.get(reviewId);
    if (!review || !canAccessUnit(user, review.unit_id)) return Response.json({ error: 'review_not_found', request_id: requestId }, { status: 404 });
    const roles = REVIEW_ROLES[review.review_type] || REVIEW_ROLES.other;
    if (!roles.includes(user.role) && !(user.permissions || []).includes('documents.review')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }
    if (['approved', 'corrected', 'rejected', 'cancelled'].includes(review.status)) {
      return Response.json({ review, duplicate: true, request_id: requestId });
    }

    const now = new Date().toISOString();
    const status = action === 'correct' ? 'corrected' : (action === 'reject' ? 'rejected' : 'approved');
    const updated = await base44.asServiceRole.entities.HumanReview.update(review.id, {
      status,
      corrected_data: correctedData,
      reviewed_by_user_id: user.id,
      reviewed_at: now,
      decision_reason: reason || `review_${action}`,
    });

    if (review.ai_job_id) {
      try {
        await base44.asServiceRole.entities.AIJob.update(review.ai_job_id, {
          status: action === 'reject' ? 'cancelled' : 'completed',
          completed_at: now,
        });
      } catch (_) {
        // Revisões antigas podem não possuir uma tarefa de IA acessível.
      }
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: action === 'approve' ? 'approve' : (action === 'reject' ? 'reject' : 'update'),
      entity_type: 'human_review',
      entity_id: review.id,
      item_label: review.summary,
      reason: reason || `review_${action}`,
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: review.unit_id,
      request_id: requestId,
      before_data: { status: review.status, proposed_data: review.proposed_data },
      after_data: { status, corrected_data: correctedData },
      success: true,
    });

    return Response.json({ review: updated, request_id: requestId });
  } catch (error) {
    console.error(`[resolve_human_review:${requestId}]`, error);
    return Response.json({ error: 'review_resolution_failed', request_id: requestId }, { status: 500 });
  }
});
