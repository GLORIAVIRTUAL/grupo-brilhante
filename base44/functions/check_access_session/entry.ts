import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const principal = await authorizeUserOrInternal(base44, req, {}, {
      allowInternal: false,
      source: 'check_access_session',
    });

    return Response.json({
      allowed: true,
      role: principal.role,
      permissions: principal.permissions,
      unit_ids: principal.unitIds,
      mfa_status: principal.user?.mfa_status || 'not_required',
      access_revision: principal.user?.access_revision || 1,
    });
  } catch (error) {
    return securityErrorResponse(error);
  }
});
