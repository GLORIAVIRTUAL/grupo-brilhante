import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const principal = await authorizeUserOrInternal(base44, req, {}, {
            allowInternal: false,
            source: 'get_all_units',
        });

        const allUnits = await base44.asServiceRole.entities.Unit.list('name', 200);
        const units = principal.role === 'super_admin'
            ? allUnits
            : allUnits.filter((unit) => principal.unitIds.includes(unit.id));
        return Response.json({ units });
    } catch (error) {
        console.error('Error in get_all_units:', error?.code || error?.message || error);
        return securityErrorResponse(error);
    }
});