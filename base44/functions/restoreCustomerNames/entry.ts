import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Restaura o nome real de clientes salvos como "Novo Cliente" / "Cliente" / vazio,
// usando o nome que ficou gravado no raw_payload das mensagens (senderName / chatName / pushName).
// Diferente do refreshCustomerNames, NÃO depende de telefone real (resolve casos LID).
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        await enforceExistingUserSecurity(base44, req, user, { source: 'restoreCustomerNames' });
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

        const isInvalidName = (n) => {
            if (!n) return true;
            const low = String(n).toLowerCase().trim();
            if (!low) return true;
            if (low === 'cliente' || low === 'novo cliente') return true;
            if (low.includes('@lid') || low.includes('@s.whatsapp.net') || low.includes('@c.us')) return true;
            if (low.includes('cliente desconhecido')) return true;
            if (/^\+?\d{8,}$/.test(low.replace(/\s/g, ''))) return true;
            return false;
        };

        const extractName = (raw) => {
            if (!raw || typeof raw !== 'object') return null;
            const candidates = [
                raw.senderName, raw.chatName, raw.pushName, raw.notifyName,
                raw.contactName, raw.name, raw.notify, raw.pushname
            ];
            for (const c of candidates) {
                if (c && !isInvalidName(c)) return String(c).trim();
            }
            return null;
        };

        // 1. Buscar clientes que precisam de nome
        const sleep0 = (ms) => new Promise(r => setTimeout(r, ms));
        let allCustomers = [];
        for (let i = 0; i < 4; i++) {
            try {
                allCustomers = await base44.asServiceRole.entities.Customer.list('-created_date', 1000);
                break;
            } catch (err) {
                if (i < 3) { await sleep0(2000 * (i + 1)); continue; }
                throw err;
            }
        }
        const toFix = allCustomers.filter(c => isInvalidName(c.full_name));

        const updated = [];
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // Executa uma chamada da SDK com retry/backoff em caso de 429 (rate limit).
        const withRetry = async (fn, attempts = 4) => {
            for (let i = 0; i < attempts; i++) {
                try {
                    return await fn();
                } catch (err) {
                    const status = err?.status || err?.response?.status;
                    const isRate = status === 429 || String(err?.message || '').includes('Rate limit');
                    if (isRate && i < attempts - 1) {
                        await sleep(1500 * (i + 1));
                        continue;
                    }
                    throw err;
                }
            }
        };

        for (const customer of toFix) {
            try {
                await sleep(600); // evita rate limit (429) da SDK
                // 2. Conversas do cliente
                const conversations = await withRetry(() => base44.asServiceRole.entities.Conversation.filter({ customer_id: customer.id }));
                if (!conversations.length) continue;

                let foundName = null;
                for (const conv of conversations) {
                    if (foundName) break;
                    const messages = await withRetry(() => base44.asServiceRole.entities.Message.filter(
                        { conversation_id: conv.id, direction: 'IN' }, '-created_date', 50
                    ));
                    for (const msg of messages) {
                        const name = extractName(msg.raw_payload);
                        if (name) { foundName = name; break; }
                    }
                }

                if (foundName) {
                    await withRetry(() => base44.asServiceRole.entities.Customer.update(customer.id, { full_name: foundName }));
                    updated.push({ id: customer.id, full_name: foundName });
                }
            } catch (err) {
                console.warn(`Skipping customer ${customer.id}:`, err.message);
            }
        }

        return Response.json({ updated, checked: toFix.length });
    } catch (error) {
        console.error("restoreCustomerNames error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});