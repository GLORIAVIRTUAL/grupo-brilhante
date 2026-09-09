import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

const DEFINITIONS = [
  { id: 'garment_ai', name: 'IA para peças e documentos', type: 'ai', required: ['GEMINI_API_KEY'] },
  { id: 'asaas', name: 'Pagamentos Asaas', type: 'payment', required: ['ASAAS_API_KEY', 'ASAAS_ENVIRONMENT'] },
  { id: 'zapi_main', name: 'WhatsApp Z-API principal', type: 'messaging', required: ['ZAPI_INSTANCE_ID', 'ZAPI_TOKEN', 'ZAPI_SECURITY_TOKEN'] },
  { id: 'zapi_moinhos', name: 'WhatsApp Z-API Moinhos', type: 'messaging', required: ['ZAPI_MOINHOS_INSTANCE_ID', 'ZAPI_MOINHOS_TOKEN', 'ZAPI_MOINHOS_SECURITY_TOKEN'] },
  { id: 'whatsapp_meta', name: 'WhatsApp Cloud Moinhos', type: 'messaging', required: ['WHATSAPP_MOINHOS_TOKEN', 'WHATSAPP_MOINHOS_PHONE_NUMBER_ID', 'WHATSAPP_MOINHOS_APP_SECRET', 'WHATSAPP_MOINHOS_VERIFY_TOKEN'] },
  { id: 'instagram', name: 'Instagram Messaging', type: 'messaging', required: ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'INSTAGRAM_BUSINESS_ACCOUNT_ID'] },
  { id: 'messenger', name: 'Facebook Messenger', type: 'messaging', required: ['FACEBOOK_PAGE_ACCESS_TOKEN', 'FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN', 'FACEBOOK_PAGE_ID'] },
  { id: 'bb', name: 'Banco do Brasil — Cobrança e Pix', type: 'banking', required: ['BB_CLIENT_ID', 'BB_CLIENT_SECRET', 'BB_DEVELOPER_APPLICATION_KEY', 'BB_API_BASE_URL', 'BB_WEBHOOK_TOKEN'], gates: ['BB_EXTERNAL_REQUESTS_ENABLED'], productionGates: ['BB_PRODUCTION_ENABLED'] },
  { id: 'focus_nfe', name: 'Focus NFe — NFS-e', type: 'fiscal', required: ['FOCUSNFE_TOKEN', 'FOCUSNFE_WEBHOOK_TOKEN'], gates: ['FOCUSNFE_EXTERNAL_REQUESTS_ENABLED'], productionGates: ['FOCUSNFE_PRODUCTION_ENABLED'] },
  { id: 'conta_azul_migration', name: 'Migração Conta Azul', type: 'migration', required: [], gates: ['CONTA_AZUL_MIGRATION_ENABLED'] },
  { id: 'payroll_sync', name: 'Sincronização operacional de DP', type: 'payroll', required: ['PAYROLL_API_BASE_URL', 'PAYROLL_API_TOKEN', 'PAYROLL_ALLOWED_HOSTS', 'PAYROLL_SCHEDULE_PATH'], gates: ['PAYROLL_SYNC_ENABLED'], productionGates: ['PAYROLL_SYNC_PRODUCTION_ENABLED'] },
  { id: 'scheduled_reports', name: 'Entrega externa de relatórios', type: 'reporting', required: [], gates: ['REPORT_EXTERNAL_DELIVERY_ENABLED'] },
  { id: 'maps', name: 'Google Maps', type: 'maps', required: ['GOOGLE_MAPS_API_KEY'] },
  { id: 'automation', name: 'Automações internas', type: 'automation', required: ['INTERNAL_FUNCTION_TOKEN'] },
];

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }
    const base44 = createClientFromRequest(req);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const principal = await authorizeUserOrInternal(base44, req, body, { allowInternal: false, source: 'integration_status' });
    const user = principal.user;
    if (!['super_admin', 'admin', 'manager'].includes(user.role) && !(user.permissions || []).includes('integrations.view_status')) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    const integrations = DEFINITIONS.map((definition) => {
      const missingKeys = definition.required.filter((key) => !Deno.env.get(key));
      const gates = definition.gates || [];
      const productionGates = definition.productionGates || [];
      const enabled = gates.length === 0 || gates.every((key) => Deno.env.get(key) === 'true');
      const productionEnabled = productionGates.length > 0 && productionGates.every((key) => Deno.env.get(key) === 'true');
      const configured = missingKeys.length === 0;
      return {
        id: definition.id,
        display_name: definition.name,
        integration_type: definition.type,
        configured,
        enabled,
        production_enabled: productionEnabled,
        health_status: !configured ? 'not_configured' : !enabled ? 'disabled' : 'unknown',
        required_secret_names: definition.required,
        missing_secret_names: missingKeys,
        gate_names: gates,
        production_gate_names: productionGates,
      };
    });

    return Response.json({
      integrations,
      debug_endpoints_enabled: Deno.env.get('ENABLE_INTERNAL_DEBUG_ENDPOINTS') === 'true',
      checked_at: new Date().toISOString(),
      request_id: requestId,
    });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error(`[integration_status:${requestId}]`, error);
    return Response.json({ error: 'integration_status_failed', request_id: requestId }, { status: 500 });
  }
});