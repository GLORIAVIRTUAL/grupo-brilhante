import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { authorizeUserOrInternal, securityErrorResponse, SecurityError } from '../../shared/functionSecurity.js';
import { normalizeEnterpriseCode } from '../../shared/enterpriseCore.js';

function normalizeSubdomain(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const legalEntityId = String(body.legal_entity_id || '').trim();
    if (!legalEntityId) throw new SecurityError('Empresa legal obrigatória.', 422, 'LEGAL_ENTITY_REQUIRED');
    const principal = await authorizeUserOrInternal(base44, req, body, {
      roles: ['super_admin', 'admin'],
      permission: 'companies.manage',
      legalEntityId,
      requireMfa: true,
      allowInternal: false,
      source: 'manage_unit',
    });
    const legalEntity = await base44.asServiceRole.entities.LegalEntity.get(legalEntityId).catch(() => null);
    if (!legalEntity) throw new SecurityError('Empresa legal não encontrada.', 404, 'LEGAL_ENTITY_NOT_FOUND');

    const action = String(body.action || 'create');
    if (action !== 'create') throw new SecurityError('Ação não suportada.', 400, 'INVALID_ACTION');

    const name = String(body.name || '').trim();
    const code = normalizeEnterpriseCode(body.code || name);
    const subdomain = normalizeSubdomain(body.subdomain);
    const ownerEmail = normalizeEmail(body.owner_email);
    if (name.length < 3 || name.length > 120) throw new SecurityError('Nome da unidade inválido.', 400, 'INVALID_UNIT_NAME');
    if (!code) throw new SecurityError('Código da unidade inválido.', 422, 'INVALID_UNIT_CODE');
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(subdomain)) throw new SecurityError('Subdomínio inválido.', 400, 'INVALID_SUBDOMAIN');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new SecurityError('E-mail do proprietário inválido.', 400, 'INVALID_OWNER_EMAIL');

    const [sameSubdomain, sameName, sameCode] = await Promise.all([
      base44.asServiceRole.entities.Unit.filter({ subdomain }, '-created_at', 1),
      base44.asServiceRole.entities.Unit.filter({ legal_entity_id: legalEntityId, name }, '-created_at', 1),
      base44.asServiceRole.entities.Unit.filter({ legal_entity_id: legalEntityId, code }, '-created_at', 1),
    ]);
    if (sameSubdomain.length) throw new SecurityError('Subdomínio já cadastrado.', 409, 'SUBDOMAIN_EXISTS');
    if (sameName.length) throw new SecurityError('Já existe uma unidade com esse nome nessa empresa.', 409, 'UNIT_NAME_EXISTS');
    if (sameCode.length) throw new SecurityError('Já existe uma unidade com esse código nessa empresa.', 409, 'UNIT_CODE_EXISTS');

    const unit = await base44.asServiceRole.entities.Unit.create({
      legal_entity_id: legalEntityId,
      code,
      name,
      unit_type: body.unit_type || 'branch',
      subdomain,
      owner_email: ownerEmail,
      cost_center_id: body.cost_center_id || undefined,
      default_warehouse_id: body.default_warehouse_id || undefined,
      address: String(body.address || '').trim() || undefined,
      structured_address: body.structured_address || undefined,
      status: 'pending',
      plan_price: Number(body.plan_price || 0),
      payment_status: 'trial',
      created_at: new Date().toISOString(),
      created_by_user_id: principal.user.id,
      updated_by_user_id: principal.user.id,
    });

    await base44.asServiceRole.entities.AuditLog.create({
      user_id: principal.user.id,
      user_email: principal.user.email,
      action: 'create',
      entity_type: 'unit',
      entity_id: unit.id,
      item_label: name,
      reason: String(body.reason || 'Cadastro administrativo de unidade').trim(),
      legal_entity_id: legalEntityId,
      unit_id: unit.id,
      request_id: requestId,
      success: true,
      domain: 'governance',
      severity: 'critical',
      metadata: { code, legal_entity_id: legalEntityId, subdomain, owner_email: ownerEmail, initial_status: 'pending' },
    });

    return Response.json({ success: true, unit, request_id: requestId }, { status: 201 });
  } catch (error) {
    console.error(`[manage_unit:${requestId}]`, error?.code || error?.message || error);
    return securityErrorResponse(error);
  }
});
