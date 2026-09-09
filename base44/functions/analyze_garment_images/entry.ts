import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'manager', 'attendant']);
const MAX_IMAGES = 12;

function canAccessUnit(user: any, unitId?: string) {
  if (!unitId || ['super_admin', 'admin'].includes(user?.role)) return true;
  return new Set([user?.primary_unit_id, ...(user?.allowed_unit_ids || [])].filter(Boolean)).has(unitId);
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'analyze_garment_images' });
    if (!user) return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    if (!ALLOWED_ROLES.has(user.role || 'attendant') && !(user.permissions || []).includes('quotes.manage')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const { document_asset_ids: assetIds = [], customer_id: customerId } = await req.json();
    if (!Array.isArray(assetIds) || assetIds.length === 0 || assetIds.length > MAX_IMAGES) {
      return Response.json({ error: 'invalid_image_count', max_images: MAX_IMAGES, request_id: requestId }, { status: 400 });
    }

    const assets = [];
    for (const assetId of assetIds) {
      const asset = await base44.asServiceRole.entities.DocumentAsset.get(assetId);
      if (!asset || !['garment_photo', 'garment_label', 'garment_damage'].includes(asset.document_type)) {
        return Response.json({ error: 'invalid_garment_asset', asset_id: assetId, request_id: requestId }, { status: 422 });
      }
      if (!canAccessUnit(user, asset.unit_id)) {
        return Response.json({ error: 'forbidden_unit', request_id: requestId }, { status: 403 });
      }
      if (!['valid'].includes(asset.validation_status) || ['rejected', 'quarantined'].includes(asset.scan_status)) {
        return Response.json({ error: 'asset_not_safe_for_processing', asset_id: assetId, request_id: requestId }, { status: 422 });
      }
      assets.push(asset);
    }

    const results = await Promise.all(assets.map(async (asset: any, index: number) => {
      const startedAt = Date.now();
      const aiJob = await base44.asServiceRole.entities.AIJob.create({
        unit_id: asset.unit_id,
        job_type: 'garment_recognition',
        status: 'processing',
        document_asset_ids: [asset.id],
        model: 'configured_runtime_model',
        prompt_version: 'garment-recognition-v2',
        attempts: 1,
        started_at: new Date().toISOString(),
        created_by_user_id: user.id,
        request_id: requestId,
      });

      try {
        const response = await base44.asServiceRole.functions.invoke('openai_vision', {
          image_url: asset.storage_key,
          _internal_token: Deno.env.get('INTERNAL_FUNCTION_TOKEN'),
        });
        const result = response?.data || response;
        const confidence = Number(result?.confidence || 0);
        const needsReview = Boolean(result?.human_review_required) || !result?.catalog_match || confidence < 0.92;

        await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
          status: needsReview ? 'human_review' : 'completed',
          entity_type: 'document_asset',
          entity_id: asset.id,
          catalog_version: result?.catalog_version,
          confidence,
          field_confidence: {
            product: confidence,
            attributes: Math.min(confidence, 0.85),
            damages: Math.min(confidence, 0.8),
          },
          result,
          latency_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        });

        let review = null;
        if (needsReview) {
          review = await base44.asServiceRole.entities.HumanReview.create({
            unit_id: asset.unit_id,
            review_type: 'garment_recognition',
            status: 'pending',
            priority: confidence < 0.5 ? 'high' : 'normal',
            entity_type: 'document_asset',
            entity_id: asset.id,
            ai_job_id: aiJob.id,
            document_asset_ids: [asset.id],
            reason_codes: [
              ...(!result?.catalog_match ? ['catalog_match_missing'] : []),
              ...(confidence < 0.92 ? ['low_confidence'] : []),
            ],
            summary: `Revisar reconhecimento da foto ${index + 1}`,
            proposed_data: result,
            request_id: requestId,
          });
        }

        return {
          line_id: crypto.randomUUID(),
          document_asset_ids: [asset.id],
          image_url: asset.storage_key,
          product_id: result?.catalog_product_id || null,
          garment_type: result?.garment_type || 'Peça não identificada',
          qty: 1,
          unit_price: Number(result?.estimated_price || 0),
          subtotal: Number(result?.estimated_price || 0),
          total_amount: Number(result?.estimated_price || 0),
          confidence,
          recognition_status: needsReview ? 'suggested' : 'confirmed',
          attributes: result?.attributes || {},
          damages: result?.damages || [],
          risk_tags: [],
          services: (result?.suggested_service || []).map((name: string) => ({ name, quantity: 1, unit_price: 0 })),
          notes: result?.notes || '',
          review_reason: needsReview ? 'Confirme o produto e os atributos antes de aprovar.' : '',
          ai_job_id: aiJob.id,
          human_review_id: review?.id || null,
        };
      } catch (error) {
        await base44.asServiceRole.entities.AIJob.update(aiJob.id, {
          status: 'failed',
          error_code: 'vision_processing_failed',
          error_message: 'A análise automática não ficou disponível.',
          latency_ms: Date.now() - startedAt,
          completed_at: new Date().toISOString(),
        });

        const review = await base44.asServiceRole.entities.HumanReview.create({
          unit_id: asset.unit_id,
          review_type: 'garment_recognition',
          status: 'pending',
          priority: 'high',
          entity_type: 'document_asset',
          entity_id: asset.id,
          ai_job_id: aiJob.id,
          document_asset_ids: [asset.id],
          reason_codes: ['ai_unavailable'],
          summary: `Classificação manual necessária para a foto ${index + 1}`,
          proposed_data: {},
          request_id: requestId,
        });

        return {
          line_id: crypto.randomUUID(),
          document_asset_ids: [asset.id],
          image_url: asset.storage_key,
          product_id: null,
          garment_type: 'Peça não identificada',
          qty: 1,
          unit_price: 0,
          subtotal: 0,
          total_amount: 0,
          confidence: 0,
          recognition_status: 'suggested',
          attributes: {},
          damages: [],
          risk_tags: [],
          services: [],
          notes: 'IA indisponível; preencha manualmente.',
          review_reason: 'A análise automática não ficou disponível.',
          ai_job_id: aiJob.id,
          human_review_id: review.id,
        };
      }
    }));

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'ai_review',
      entity_type: 'ai_job',
      entity_id: requestId,
      item_label: `${results.length} foto(s) de peça`,
      reason: 'garment_batch_analyzed',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      unit_id: assets[0]?.unit_id,
      request_id: requestId,
      metadata: { customer_id: customerId, result_count: results.length },
      success: true,
    });

    return Response.json({ items: results, request_id: requestId });
  } catch (error) {
    console.error(`[analyze_garment_images:${requestId}]`, error);
    return Response.json({ error: 'garment_analysis_failed', request_id: requestId }, { status: 500 });
  }
});
