import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { getPickupDateRange, getPickupLocalHour, getPickupScheduleForDate, getPickupSlotIso } from '../../shared/pickupSchedule.js';
import { requireInternalRequest, securityErrorResponse } from '../../shared/functionSecurity.js';

// Cria de fato uma coleta (Pickup) no calendário. Reutilizada pela proteção anti-alucinação
// do orchestrator para garantir que toda confirmação de coleta gere um registro real.
Deno.serve(async (req) => {
    try {
        if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
        const base44 = createClientFromRequest(req);
        const body = await req.json();
        requireInternalRequest(req, body);
        const { date, period, address, notes, customer_id, weekday } = body;
        if (!date || !period || !customer_id) {
            return Response.json({ error: 'Faltam dados (date, period, customer_id).' }, { status: 400 });
        }

        // GUARDA ANTI-ALUCINAÇÃO DE ENDEREÇO: só agenda se o endereço tiver sido realmente
        // informado pelo cliente (nas mensagens recebidas) ou já estiver cadastrado.
        const normalize = (s: string) => String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

        const addrNorm = normalize(address);
        if (!addrNorm) {
            return Response.json({ error: 'ENDEREÇO NÃO INFORMADO: não agende. Pergunte o endereço completo (rua, número, complemento e bairro) ao cliente antes de confirmar a coleta.' });
        }

        const customer = await base44.asServiceRole.entities.Customer.get(customer_id).catch(() => null);
        const savedAddr = normalize(`${customer?.address || ''} ${customer?.address_number || ''} ${customer?.address_complement || ''}`);

        const convs = await base44.asServiceRole.entities.Conversation.filter({ customer_id });
        let inboundText = '';
        for (const cv of convs) {
            const msgs = await base44.asServiceRole.entities.Message.filter({ conversation_id: cv.id, direction: 'IN' }, '-created_date', 60);
            inboundText += ' ' + msgs.map(m => m.text || '').join(' ');
        }
        const haystack = normalize(inboundText) + ' ' + savedAddr;

        const streetWords = addrNorm.split(' ').filter(w => w.length >= 4 && !['rua','avenida','apto','apartamento','bloco','casa','numero','porto','alegre'].includes(w));
        const addressConfirmed = streetWords.length > 0 && streetWords.some(w => haystack.includes(w));
        if (!addressConfirmed) {
            return Response.json({ error: 'ENDEREÇO NÃO CONFIRMADO PELO CLIENTE: nunca invente endereço. Pergunte ao cliente o endereço completo (rua, número, complemento e bairro) e só agende depois que ele responder.' });
        }

        // GUARDA ANTI-ALUCINAÇÃO DE DIA DA SEMANA: a IA envia o dia que ela ACHA que a data é.
        // Se a data não corresponder ao dia prometido ao cliente, não agenda (evita "coleta no
        // sábado" cair numa quinta-feira, como já aconteceu).
        const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const actualWeekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
        if (weekday) {
            const claimed = normalize(weekday).replace('-feira', '').trim();
            if (!claimed.startsWith(actualWeekday) && !actualWeekday.startsWith(claimed)) {
                return Response.json({
                    error: `DATA INCONSISTENTE: ${date} é ${actualWeekday}-feira/${actualWeekday}, e não "${weekday}". NÃO agende. Confira o calendário injetado, encontre a data correta do dia prometido ao cliente e chame novamente com a data certa.`
                });
            }
        }

        const schedule = getPickupScheduleForDate(date);
        if (!schedule.isOpen) {
            return Response.json({ error: schedule.error });
        }
        if (period === 'afternoon' && schedule.afternoonSlots.length === 0) {
            return Response.json({ error: 'Aos sábados, as coletas acontecem somente pela manhã, das 9h às 12h. Sugira o turno da manhã ou outra data.' });
        }
        const targetSlots = period === 'morning' ? schedule.morningSlots : schedule.afternoonSlots;
        const MORNING_CAPACITY = schedule.morningCapacity;
        const AFTERNOON_CAPACITY = schedule.afternoonCapacity;

        const targetRange = getPickupDateRange(date);

        const existingPickups = await base44.asServiceRole.entities.Pickup.filter({
            scheduled_at: { $gte: targetRange.start, $lte: targetRange.end },
            status: { $ne: 'cancelled' }
        });

        const otherPickups = existingPickups.filter(p => p.customer_id !== customer_id);
        let shiftCount = 0;
        for (const p of otherPickups) {
            const localHour = getPickupLocalHour(p.scheduled_at);
            if (period === 'morning' && localHour < 13) shiftCount++;
            if (period === 'afternoon' && localHour >= 13) shiftCount++;
        }
        const capacity = period === 'morning' ? MORNING_CAPACITY : AFTERNOON_CAPACITY;
        if (shiftCount >= capacity) {
            return Response.json({ error: `O turno da ${period === 'morning' ? 'manhã' : 'tarde'} para ${date} está LOTADO. Sugira outro turno ou data.` });
        }

        // Cancela coletas agendadas anteriores do mesmo cliente
        const existingCustomerPickups = await base44.asServiceRole.entities.Pickup.filter({ customer_id, status: 'scheduled' });
        for (const oldPickup of existingCustomerPickups) {
            await base44.asServiceRole.entities.Pickup.update(oldPickup.id, { status: 'cancelled' });
        }

        const refreshedPickups = existingPickups.filter(p => p.customer_id !== customer_id);
        let selectedSlot = null;
        for (const slot of targetSlots) {
            const isTaken = refreshedPickups.some(p => {
                const slotIso = getPickupSlotIso(date, slot);
                return Math.abs(new Date(p.scheduled_at).getTime() - new Date(slotIso).getTime()) < 60000;
            });
            if (!isTaken) { selectedSlot = slot; break; }
        }

        if (!selectedSlot) {
            return Response.json({ error: 'Turno lotado. Ofereça outro turno ou data.' });
        }

        const finalDate = getPickupSlotIso(date, selectedSlot);
        await base44.asServiceRole.entities.Pickup.create({
            customer_id,
            unit_id: customer?.unit_id,
            scheduled_at: finalDate,
            status: 'scheduled',
            address: address || '',
            notes: notes || '',
            source: 'ai',
            created_by_name: 'Glória (IA)'
        });

        const shiftInfo = period === 'morning' ? `(turno manhã) das ${schedule.isSaturday ? '9h' : '8h'} às 12h` : '(turno tarde) das 13h às 16h';
        const [yy, mm, dd] = date.split('-');
        return Response.json({
            success: true,
            date,
            weekday: actualWeekday,
            message: `Coleta agendada com sucesso para ${actualWeekday}, ${dd}/${mm}/${yy}, ${shiftInfo}. Confirme ao cliente EXATAMENTE esta data e este dia da semana.`
        });
    } catch (error) {
        if (error?.name === 'SecurityError') return securityErrorResponse(error);
        console.error('schedulePickupTool error:', error?.message || error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});