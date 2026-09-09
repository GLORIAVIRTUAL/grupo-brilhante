import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        await enforceExistingUserSecurity(base44, req, user, { source: 'sendProspectDispatch' });

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { prospect_ids, message, image_url, send_to_all, channels, email_subject } = await req.json();
        const selectedChannels = Array.isArray(channels) && channels.length ? channels : ['whatsapp'];
        const sendWhatsapp = selectedChannels.includes('whatsapp');
        const sendEmail = selectedChannels.includes('email');

        if (!message && !image_url) {
            return Response.json({ error: 'Envie uma mensagem ou uma imagem' }, { status: 400 });
        }

        const INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID");
        const TOKEN = Deno.env.get("ZAPI_TOKEN");
        const CLIENT_TOKEN = Deno.env.get("ZAPI_SECURITY_TOKEN");

        if (sendWhatsapp && (!INSTANCE_ID || !TOKEN)) {
            return Response.json({ error: 'Z-API não configurada.' }, { status: 400 });
        }

        let prospects = [];
        if (send_to_all) {
            prospects = await base44.asServiceRole.entities.Prospect.list('-created_date', 10000);
        } else if (prospect_ids && prospect_ids.length > 0) {
            for (const id of prospect_ids) {
                const p = await base44.asServiceRole.entities.Prospect.get(id);
                if (p) prospects.push(p);
            }
        }

        prospects = prospects.filter(p => (sendWhatsapp && p.phone) || (sendEmail && p.email));

        if (prospects.length === 0) {
            return Response.json({ error: 'Nenhuma empresa elegível encontrada para os canais escolhidos.' }, { status: 400 });
        }

        const textUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-text`;
        const imageApiUrl = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}/send-image`;
        const results = { sent: 0, failed: 0, total: prospects.length, emails_sent: 0, emails_failed: 0 };

        for (const prospect of prospects) {
            const finalMessage = (message || '')
                .replace(/{empresa}/gi, prospect.company_name || 'Empresa')
                .replace(/{contato}/gi, prospect.contact_name || '')
                .replace(/{nome}/gi, prospect.contact_name || prospect.company_name || '');

            if (sendWhatsapp && prospect.phone) {
                const phone = prospect.phone;
                try {
                    const response = await fetch(image_url ? imageApiUrl : textUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'client-token': CLIENT_TOKEN || ''
                        },
                        body: JSON.stringify(
                            image_url
                                ? { phone, image: image_url, caption: finalMessage }
                                : { phone, message: finalMessage }
                        )
                    });

                    if (response.ok) {
                        results.sent++;
                    } else {
                        results.failed++;
                        const err = await response.json();
                        console.error(`Failed to send to ${phone}:`, err);
                    }

                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (err) {
                    results.failed++;
                    console.error(`Error sending to ${phone}:`, err.message);
                }
            }

            if (sendEmail && prospect.email) {
                try {
                    const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#222">`
                        + `<p>${finalMessage.replace(/\n/g, '<br/>')}</p>`
                        + (image_url ? `<p><img src="${image_url}" alt="" style="max-width:100%;border-radius:8px"/></p>` : '')
                        + `</div>`;

                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: prospect.email,
                        subject: email_subject || 'Serviços corporativos 5àsec',
                        body: htmlBody
                    });
                    results.emails_sent++;
                } catch (err) {
                    results.emails_failed++;
                    console.error(`Error emailing ${prospect.email}:`, err.message);
                }
            }
        }

        return Response.json({ status: "success", results });
    } catch (error) {
        console.error("Error in sendProspectDispatch:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});