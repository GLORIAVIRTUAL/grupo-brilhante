import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { authorizeUserOrInternal, securityErrorResponse } from '../../shared/functionSecurity.js';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const principal = await authorizeUserOrInternal(base44, req, body, { source: 'processDispatchQueue' });
    if (principal.kind === 'user' && !['super_admin', 'admin'].includes(principal.role)) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const now = new Date();
    const queued = await base44.asServiceRole.entities.DispatchQueue.filter({ status: 'queued' }, 'scheduled_at', 200);
    const due = queued.filter(item => new Date(item.scheduled_at) <= now).slice(0, 20);
    const results = { sent: 0, failed: 0, pending: queued.length - due.length };

    for (const item of due) {
      await base44.asServiceRole.entities.DispatchQueue.update(item.id, { status: 'sending', attempts: Number(item.attempts || 0) + 1 });
      const prefix = item.sender === 'moinhos' ? 'ZAPI_MOINHOS' : 'ZAPI';
      const instanceId = Deno.env.get(`${prefix}_INSTANCE_ID`);
      const token = Deno.env.get(`${prefix}_TOKEN`);
      const clientToken = Deno.env.get(`${prefix}_SECURITY_TOKEN`);
      const endpoint = item.image_url ? 'send-image' : 'send-text';
      const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/${endpoint}`;
      const optOutText = '\n\nPara não receber mais mensagens, responda SAIR.';
      const finalMessage = `${item.message}${optOutText}`;

      try {
        if (!instanceId || !token || !clientToken) throw new Error(`Conexão ${item.sender} não configurada`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'client-token': clientToken },
          body: JSON.stringify(item.image_url ? { phone: item.phone, image: item.image_url, caption: finalMessage } : { phone: item.phone, message: finalMessage }),
          signal: AbortSignal.timeout(15000)
        });
        const providerResult = await response.json();
        if (!response.ok) throw new Error(`Falha Z-API (${response.status})`);

        const source = item.sender === 'moinhos' ? 'zapi_moinhos' : 'zapi_main';
        const conversations = await base44.asServiceRole.entities.Conversation.filter({ customer_id: item.customer_id, channel: 'WHATSAPP' }, '-created_date', 20);
        let conversation = conversations.find(conv => conv.metadata?.source === source);
        if (!conversation) {
          conversation = await base44.asServiceRole.entities.Conversation.create({
            customer_id: item.customer_id,
            channel: 'WHATSAPP',
            status: 'OPEN',
            zapi_instance_id: instanceId,
            last_message_at: new Date().toISOString(),
            metadata: { source }
          });
        }
        const newMessage = await base44.asServiceRole.entities.Message.create({
          conversation_id: conversation.id,
          direction: 'OUT',
          type: item.image_url ? 'IMAGE' : 'TEXT',
          text: finalMessage,
          media_file_id: item.image_url || null,
          raw_payload: providerResult
        });
        const sentAt = new Date().toISOString();
        const customerUpdate = item.type === 'consent_request'
          ? {
              last_outbound_at: sentAt,
              opt_in_whatsapp: false,
              whatsapp_consent_status: 'pending',
              whatsapp_consent_requested_at: sentAt,
              whatsapp_consent_request_text: item.message,
              whatsapp_consent_source: item.sender === 'moinhos' ? 'zapi_moinhos' : 'zapi_main'
            }
          : { last_outbound_at: sentAt };
        await Promise.all([
          base44.asServiceRole.entities.Conversation.update(conversation.id, { last_message_id: newMessage.id, last_message_at: sentAt }),
          base44.asServiceRole.entities.Customer.update(item.customer_id, customerUpdate),
          base44.asServiceRole.entities.DispatchQueue.update(item.id, { status: 'sent', sent_at: sentAt, error: '' }),
          base44.asServiceRole.entities.AutomatedDispatch.create({
            type: item.type,
            customer_id: item.customer_id,
            message: finalMessage,
            status: 'sent',
            sent_at: sentAt,
            phone: item.phone,
            metadata: { campaign_id: item.campaign_id, queue_id: item.id, unit_id: item.unit_id, sender: item.sender, safety_mode: true }
          })
        ]);
        results.sent++;
      } catch (error) {
        await Promise.all([
          base44.asServiceRole.entities.DispatchQueue.update(item.id, { status: 'failed', error: error.message }),
          base44.asServiceRole.entities.AutomatedDispatch.create({
            type: item.type,
            customer_id: item.customer_id,
            message: item.message,
            status: 'failed',
            sent_at: new Date().toISOString(),
            phone: item.phone,
            metadata: { campaign_id: item.campaign_id, queue_id: item.id, error: error.message }
          })
        ]);
        results.failed++;
      }
      if (due.indexOf(item) < due.length - 1) await new Promise(resolve => setTimeout(resolve, 1500 + Math.floor(Math.random() * 1500)));
    }

    return Response.json({ status: 'success', results });
  } catch (error) {
    if (error?.name === 'SecurityError') return securityErrorResponse(error);
    console.error('Error in processDispatchQueue:', error?.message || error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});