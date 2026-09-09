import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'sendDispatch' });
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas administradores podem agendar disparos.' }, { status: 403 });

    const payload = await req.json();
    const { type, customer_ids = [], message, send_to_all_active, image_url, unit_id = 'all', inactivity_months = 0 } = payload;
    if (!message?.trim() && !image_url) return Response.json({ error: 'Envie uma mensagem ou uma imagem' }, { status: 400 });

    const normalizePhone = (value) => {
      let digits = String(value || '').replace(/\D/g, '');
      if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
      return digits.length >= 12 && digits.length <= 13 ? digits : '';
    };
    const normalizeText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const isConsentRequestMessage = (value) => {
      const normalized = normalizeText(value);
      const asksPermission = ['posso te enviar', 'posso enviar', 'podemos te enviar', 'podemos enviar', 'voce autoriza', 'quer receber', 'gostaria de receber', 'responda sim'].some(term => normalized.includes(term));
      const mentionsCampaign = ['promoc', 'novidade', 'oferta', 'mensagem', 'whatsapp'].some(term => normalized.includes(term));
      return asksPermission && mentionsCampaign;
    };
    const moinhosConsentTemplate = `Olá, {nome}! Tudo bem? 😊\n\nTemos promoções e novidades exclusivas disponíveis agora para você, que já é cliente da 5àsec do Moinhos Shopping!\n\nPodemos enviar essas ofertas e novidades pelo WhatsApp?\n\nResponda SIM para autorizar ou NÃO para recusar.`;
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - Number(inactivity_months || 0));

    const [allCustomers, units, pendingQueue] = await Promise.all([
      base44.asServiceRole.entities.Customer.filter({ status: 'active' }, '-created_date', 10000),
      base44.asServiceRole.entities.Unit.list('name', 100),
      base44.asServiceRole.entities.DispatchQueue.filter({ status: 'queued' }, '-scheduled_at', 5000)
    ]);

    const selectedIds = new Set(customer_ids);
    const isConsentRequest = type === 'consent_request' || isConsentRequestMessage(message);
    const effectiveType = isConsentRequest ? 'consent_request' : (type || 'promotional');
    const blockedCustomerIds = new Set(
      pendingQueue.filter(item => item.type === effectiveType).map(item => item.customer_id)
    );
    let candidates = allCustomers.filter(customer => {
      if (!send_to_all_active && !selectedIds.has(customer.id)) return false;
      if (unit_id !== 'all' && customer.unit_id !== unit_id) return false;
      if (isConsentRequest) {
        const blockedStatuses = send_to_all_active ? ['accepted', 'revoked', 'pending'] : ['revoked', 'pending'];
        if (blockedStatuses.includes(customer.whatsapp_consent_status)) return false;
      } else if (customer.opt_in_whatsapp !== true || customer.whatsapp_consent_status !== 'accepted') {
        return false;
      }
      if (!normalizePhone(customer.phones?.[0])) return false;
      if (Number(inactivity_months) > 0) {
        if (!customer.last_inbound_at) return false;
        if (new Date(customer.last_inbound_at) > cutoff) return false;
      }
      const isManualConsentRepeat = isConsentRequest && !send_to_all_active;
      return isManualConsentRepeat || !blockedCustomerIds.has(customer.id);
    });

    const seenPhones = new Set();
    candidates = candidates.filter(customer => {
      const phone = normalizePhone(customer.phones?.[0]);
      if (seenPhones.has(phone)) return false;
      seenPhones.add(phone);
      return true;
    });

    if (!candidates.length) {
      const reason = isConsentRequest
        ? 'Nenhum cliente elegível para solicitação de consentimento. Verifique telefone, unidade e disparos já na fila.'
        : 'Nenhum cliente elegível. É obrigatório ter telefone e consentimento ativo, e não estar já na fila deste disparo.';
      return Response.json({ error: reason }, { status: 400 });
    }

    // Agendamento: lotes grandes são espalhados entre 9h e 17h (Brasília), de hoje até a próxima sexta-feira,
    // com intervalos variados. Lotes pequenos continuam instantâneos.
    const SPREAD_THRESHOLD = 25;
    const shouldSpread = candidates.length > SPREAD_THRESHOLD;

    const spUtcMs = (year, month, day, hour, minute) => Date.UTC(year, month, day, hour + 3, minute); // Brasília = UTC-3
    const spParts = (date) => {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
      const p = {};
      for (const part of fmt.formatToParts(date)) p[part.type] = part.value;
      return { year: Number(p.year), month: Number(p.month) - 1, day: Number(p.day), hour: Number(p.hour === '24' ? '0' : p.hour), minute: Number(p.minute) };
    };

    const buildSlots = (count) => {
      const nowParts = spParts(now);
      // Janelas diárias de 9h às 17h, começando hoje até a próxima sexta-feira (inclusive).
      const windows = [];
      for (let offset = 0; offset < 8 && windows.length < 8; offset++) {
        const dayStart = spUtcMs(nowParts.year, nowParts.month, nowParts.day + offset, 9, 0);
        const dayEnd = spUtcMs(nowParts.year, nowParts.month, nowParts.day + offset, 17, 0);
        const start = Math.max(dayStart, offset === 0 ? now.getTime() + 60 * 1000 : dayStart);
        if (start < dayEnd) windows.push({ start, end: dayEnd });
        const weekday = new Date(dayStart).getUTCDay();
        if (weekday === 5 && offset > 0) break; // para na sexta
        if (weekday === 5 && offset === 0) break;
      }
      if (!windows.length) windows.push({ start: now.getTime() + 60 * 1000, end: now.getTime() + 8 * 3600 * 1000 });

      const totalMs = windows.reduce((sum, w) => sum + (w.end - w.start), 0);
      const avgGap = totalMs / Math.max(count, 1);
      const slots = [];
      let windowIndex = 0;
      let cursor = windows[0].start;
      for (let i = 0; i < count; i++) {
        if (cursor > windows[windowIndex].end && windowIndex < windows.length - 1) {
          windowIndex++;
          cursor = windows[windowIndex].start;
        }
        slots.push(new Date(Math.min(cursor, windows[windowIndex].end)).toISOString());
        const jitter = 0.4 + Math.random() * 1.2; // intervalos variados
        cursor += Math.max(30 * 1000, avgGap * jitter);
      }
      return slots;
    };

    const campaignId = crypto.randomUUID();
    const slots = shouldSpread ? buildSlots(candidates.length) : null;
    const queueItems = candidates.map((customer, index) => {
      const phone = normalizePhone(customer.phones?.[0]);
      const unit = units.find(item => item.id === customer.unit_id);
      const sender = normalizeText(unit?.name).includes('moinhos') || normalizeText(unit?.subdomain).includes('moinhos') ? 'moinhos' : 'main';
      const selectedMessage = sender === 'moinhos' && effectiveType === 'consent_request' ? moinhosConsentTemplate : message;
      const personalized = String(selectedMessage || '').replace(/{nome}/gi, customer.full_name || 'Cliente').replace(/{telefone}/gi, phone);
      return {
        campaign_id: campaignId,
        type: effectiveType,
        customer_id: customer.id,
        unit_id: customer.unit_id || '',
        phone,
        message: personalized,
        image_url: image_url || '',
        sender,
        scheduled_at: slots ? slots[index] : now.toISOString(),
        status: 'queued',
        attempts: 0,
        triggered_by: user.email
      };
    });

    await base44.asServiceRole.entities.DispatchQueue.bulkCreate(queueItems);

    // Lotes pequenos: envia na hora. Lotes grandes seguem o cronograma da fila.
    if (!shouldSpread) {
      try {
        await base44.asServiceRole.functions.invoke('processDispatchQueue', {});
      } catch (err) {
        console.error('Instant dispatch processing failed:', err);
      }
    }

    return Response.json({
      status: 'scheduled',
      campaign_id: campaignId,
      results: { scheduled: queueItems.length, excluded: allCustomers.length - queueItems.length },
      starts_at: queueItems[0].scheduled_at,
      ends_at: queueItems[queueItems.length - 1].scheduled_at,
      safety: { instant: !shouldSpread, spread_window: shouldSpread ? '09:00-17:00 (Brasília), até sexta' : null, opt_in_required: !isConsentRequest, consent_request: isConsentRequest, duplicate_block_hours: 0 }
    });
  } catch (error) {
    console.error('Error in sendDispatch:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});