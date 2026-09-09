import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Endpoint legado mantido somente para compatibilidade de contrato.
 *
 * A implementação anterior gerava um DOCX estático com pessoas, telefones,
 * datas e métricas históricas. Os relatórios operacionais reais são produzidos
 * por `generate_specialized_report`, com autorização e escopo de unidade.
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'authentication_required', request_id: requestId }, { status: 401 });
    }

    return Response.json({
      error: 'legacy_report_retired',
      message: 'Este relatório legado foi desativado. Use a Central de Relatórios Especializados.',
      replacement_function: 'generate_specialized_report',
      request_id: requestId,
    }, { status: 410 });
  } catch (error) {
    console.error('Legacy report retirement guard failed', { request_id: requestId, error: error?.message });
    return Response.json({ error: 'legacy_report_unavailable', request_id: requestId }, { status: 500 });
  }
});
