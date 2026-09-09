import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (Deno.env.get('ENABLE_INTERNAL_DEBUG_ENDPOINTS') !== 'true') {
      return Response.json({ error: 'not_found', request_id: requestId }, { status: 404 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'list_files' });
    if (!user || !['super_admin', 'admin'].includes(user.role)) {
      return Response.json({ error: 'forbidden', request_id: requestId }, { status: 403 });
    }

    if (req.method !== 'GET') {
      return Response.json({ error: 'method_not_allowed', request_id: requestId }, { status: 405 });
    }

    const files: string[] = [];
    for (const directory of ['pages', 'functions', 'components']) {
      try {
        for await (const entry of Deno.readDir(`./${directory}`)) {
          files.push(`${directory}/${entry.name}`);
        }
      } catch (_) {
        // Diretórios ausentes são ignorados no diagnóstico.
      }
    }

    await base44.asServiceRole.entities.AuditLog.create({
      action: 'view',
      entity_type: 'integration',
      entity_id: 'internal_file_index',
      item_label: 'list_files',
      reason: 'internal_diagnostic',
      user_email: user.email,
      user_name: user.full_name || user.display_name,
      user_role: user.role,
      request_id: requestId,
      success: true,
    });

    return Response.json({ files: files.sort(), request_id: requestId });
  } catch (error) {
    console.error(`[list_files:${requestId}]`, error);
    return Response.json({ error: 'file_listing_failed', request_id: requestId }, { status: 500 });
  }
});
