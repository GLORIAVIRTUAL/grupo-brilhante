import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Auth check
        const user = await base44.auth.me();
        if (!user || !['admin', 'super_admin', 'manager'].includes(user.role)) {
             return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const input = await req.json().catch(() => ({}));
        const action = input.action || 'status'; // 'status' | 'qrcode' | 'restart'
        const store = input.store === 'moinhos' ? 'moinhos' : 'main'; // qual instância Z-API

        const instanceId = store === 'moinhos'
            ? Deno.env.get("ZAPI_MOINHOS_INSTANCE_ID")
            : Deno.env.get("ZAPI_INSTANCE_ID");
        const token = store === 'moinhos'
            ? Deno.env.get("ZAPI_MOINHOS_TOKEN")
            : Deno.env.get("ZAPI_TOKEN");

        if (!instanceId || !token) {
            return Response.json({ error: "Z-API Credentials not configured" }, { status: 500 });
        }

        const clientToken = store === 'moinhos'
            ? Deno.env.get("ZAPI_MOINHOS_SECURITY_TOKEN")
            : Deno.env.get("ZAPI_SECURITY_TOKEN");
        const baseUrl = `https://api.z-api.io/instances/${instanceId}/token/${token}`;
        const headers = { "client-token": clientToken || "" };
        
        console.log("Z-API Request:", { action, hasClientToken: !!clientToken, tokenPreview: clientToken ? clientToken.substring(0, 8) + "..." : "MISSING" });
        
        if (action === 'status') {
            const res = await fetch(`${baseUrl}/status`, { headers });
            const data = await res.json();
            // Normalize: Z-API returns { connected: bool, ... } or { error: ... }
            return Response.json(data);
        }

        if (action === 'get_webhooks') {
            const res = await fetch(`${baseUrl}/webhooks`, { headers });
            const text = await res.text();
            let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
            return Response.json({ http_status: res.status, data });
        }

        if (action === 'device') {
            const res = await fetch(`${baseUrl}/device`, { headers });
            const data = await res.json();
            return Response.json(data);
        }

        if (action === 'qrcode') {
            const res = await fetch(`${baseUrl}/qr-code/image`, { headers });
            const data = await res.json();
            return Response.json(data);
        }
        
        if (action === 'restart') {
             const res = await fetch(`${baseUrl}/restart`, { method: 'GET', headers });
             const data = await res.json();
             return Response.json(data);
        }
        
         if (action === 'disconnect') {
             const res = await fetch(`${baseUrl}/disconnect`, { method: 'GET', headers });
             const data = await res.json();
             return Response.json(data);
         }

         if (action === 'set_webhook') {
             const appId = Deno.env.get("BASE44_APP_ID");
             if (!appId) return Response.json({ error: "App ID not found" }, { status: 500 });

             const webhookFn = store === 'moinhos' ? 'zapi_moinhos_webhook' : 'zapi_webhook_receiver';
             const webhookUrl = `https://base44.app/api/apps/${appId}/functions/${webhookFn}`;

             // Webhook "Ao receber" (ESSENCIAL — mensagens recebidas)
             const res = await fetch(`${baseUrl}/update-webhook-received`, {
                 method: 'PUT',
                 headers: { ...headers, 'Content-Type': 'application/json' },
                 body: JSON.stringify({ value: webhookUrl })
             });

             // Webhook de entrega
             await fetch(`${baseUrl}/update-webhook-delivery`, {
                 method: 'PUT',
                 headers: { ...headers, 'Content-Type': 'application/json' },
                 body: JSON.stringify({ value: webhookUrl })
             });

             // Webhook de status da mensagem
             await fetch(`${baseUrl}/update-webhook-message-status`, {
                 method: 'PUT',
                 headers: { ...headers, 'Content-Type': 'application/json' },
                 body: JSON.stringify({ value: webhookUrl })
             });

             const data = await res.json();
             return Response.json({ success: true, webhookUrl, zapiResponse: data });
         }

         return Response.json({ error: "Invalid action" }, { status: 400 });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});