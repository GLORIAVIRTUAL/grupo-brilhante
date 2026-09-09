import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'chatReportPdf' });
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const fetchAll = async (entityName) => {
      const all = [];
      const pageSize = 500;
      let skip = 0;
      while (true) {
        const batch = await base44.asServiceRole.entities[entityName].list('created_date', pageSize, skip);
        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < pageSize) break;
        skip += pageSize;
        if (skip > 200000) break;
      }
      return all;
    };

    const [messages, conversations, quotes, pickups] = await Promise.all([
      fetchAll('Message'),
      fetchAll('Conversation'),
      fetchAll('Quote'),
      fetchAll('Pickup')
    ]);

    const convToCustomer = {};
    for (const c of conversations) convToCustomer[c.id] = c.customer_id;
    const toLocal = (iso) => new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);

    let firstDate = null, lastDate = null;
    const customersWhoTalked = new Set();
    const afterHoursWeekday = new Set();
    const weekendWindow = new Set();
    const customersSentDoc = new Set();
    const customersSentImage = new Set();

    for (const m of messages) {
      const custId = convToCustomer[m.conversation_id];
      if (m.created_date) {
        const d = new Date(m.created_date);
        if (!firstDate || d < firstDate) firstDate = d;
        if (!lastDate || d > lastDate) lastDate = d;
      }
      if (m.direction !== 'IN' || !custId) continue;
      customersWhoTalked.add(custId);
      const local = toLocal(m.created_date);
      const dow = local.getUTCDay();
      const hour = local.getUTCHours();
      if (dow >= 1 && dow <= 5 && (hour >= 18 || hour < 8)) afterHoursWeekday.add(custId);
      if ((dow === 6 && hour >= 12) || dow === 0 || (dow === 1 && hour < 8)) weekendWindow.add(custId);
      if (m.type === 'DOC') customersSentDoc.add(custId);
      if (m.type === 'IMAGE') customersSentImage.add(custId);
    }

    const customersWithHandoff = new Set();
    const allChatCustomers = new Set();
    for (const c of conversations) {
      if (!c.customer_id) continue;
      allChatCustomers.add(c.customer_id);
      if (c.handoff_required) customersWithHandoff.add(c.customer_id);
    }
    const customers100AI = [...allChatCustomers].filter(id => !customersWithHandoff.has(id));
    const customersWithQuote = new Set(quotes.map(q => q.customer_id).filter(Boolean));
    const customersWithAIPickup = new Set(pickups.filter(p => p.source === 'ai').map(p => p.customer_id).filter(Boolean));

    // Response time
    const msgsByConv = {};
    for (const m of messages) {
      if (!msgsByConv[m.conversation_id]) msgsByConv[m.conversation_id] = [];
      msgsByConv[m.conversation_id].push(m);
    }
    let totalResponseMs = 0, responseCount = 0;
    for (const convId of Object.keys(msgsByConv)) {
      const arr = msgsByConv[convId].slice().sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].direction === 'IN') {
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[j].direction === 'OUT') {
              const diff = new Date(arr[j].created_date) - new Date(arr[i].created_date);
              if (diff >= 0 && diff <= 60 * 60 * 1000) { totalResponseMs += diff; responseCount++; }
              break;
            }
            if (arr[j].direction === 'IN') break;
          }
        }
      }
    }
    const avgResponseSeconds = responseCount > 0 ? Math.round(totalResponseMs / responseCount / 1000) : null;

    // Topics + complaints via LLM
    const inboundTexts = messages
      .filter(m => m.direction === 'IN' && m.type === 'TEXT' && m.text && m.text.trim().length > 1)
      .map(m => m.text.trim());
    const joined = inboundTexts.join('\n');
    const corpus = joined.length > 90000 ? joined.slice(0, 90000) : joined;

    const llm = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `Você é um analista de atendimento. Abaixo está o corpus de TODAS as mensagens enviadas pelos CLIENTES (inbound) de uma lavanderia (5àsec) que usa um chatbot com IA chamado "Glória" no WhatsApp.

Produza:
1. As principais DÚVIDAS/ASSUNTOS dos clientes agrupadas por tema, com contagem aproximada de mensagens por tema, ordenadas da mais frequente para a menos frequente, com nome curto e um exemplo real.
2. Reclamações ESPECIFICAMENTE SOBRE O CHATBOT/IA (ex: "isso é um robô?", "quero falar com humano", "não entendeu"). Conte e liste exemplos. NÃO inclua reclamações sobre o serviço de lavanderia.

Corpus:
"""
${corpus}
"""`,
      response_json_schema: {
        type: 'object',
        properties: {
          principais_duvidas: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tema: { type: 'string' },
                contagem_aproximada: { type: 'number' },
                exemplo: { type: 'string' }
              }
            }
          },
          reclamacoes_sobre_chatbot: {
            type: 'object',
            properties: {
              total: { type: 'number' },
              exemplos: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    });

    // ===== BUILD PDF =====
    // jsPDF default fonts use Latin-1, not UTF-8 — accented chars break.
    // Normalize text to ASCII (remove diacritics) so it renders correctly.
    const ascii = (str) => String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x00-\x7F]/g, '');

    const fmtDate = (d) => d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-';
    const doc = new jsPDF();
    const _origText = doc.text.bind(doc);
    doc.text = (text, x, yy, opts) => {
      const clean = Array.isArray(text) ? text.map(ascii) : ascii(text);
      return _origText(clean, x, yy, opts);
    };
    const PURPLE = [76, 18, 161];
    const ORANGE = [255, 102, 0];
    const GRAY = [90, 90, 90];
    let y = 0;
    const newPageIfNeeded = (needed = 10) => { if (y + needed > 282) { doc.addPage(); y = 20; } };

    doc.setFillColor(...PURPLE);
    doc.rect(0, 0, 210, 32, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20); doc.setFont(undefined, 'bold');
    doc.text('Relatorio do Chat - 5asec', 14, 16);
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    doc.text(`Periodo: ${fmtDate(firstDate)} a ${fmtDate(lastDate)}`, 14, 25);
    y = 44;

    const sectionTitle = (txt) => {
      newPageIfNeeded(16);
      doc.setFillColor(...ORANGE); doc.rect(14, y - 5, 4, 7, 'F');
      doc.setTextColor(...PURPLE); doc.setFontSize(14); doc.setFont(undefined, 'bold');
      doc.text(txt, 22, y); y += 10;
    };
    const row = (label, value) => {
      newPageIfNeeded(8);
      doc.setTextColor(...GRAY); doc.setFontSize(11); doc.setFont(undefined, 'normal');
      doc.text(label, 18, y);
      doc.setTextColor(20, 20, 20); doc.setFont(undefined, 'bold');
      doc.text(String(value ?? '-'), 196, y, { align: 'right' });
      doc.setDrawColor(230, 230, 230); doc.line(18, y + 2, 196, y + 2);
      y += 8;
    };

    sectionTitle('Visao Geral');
    row('Clientes unicos que falaram', customersWhoTalked.size);
    row('Total de mensagens', messages.length);
    row('Total de conversas', conversations.length);
    y += 4;

    sectionTitle('Atendimento por Horario');
    row('Dias de semana apos 18h ou antes das 8h', afterHoursWeekday.size);
    row('Fim de semana (Sab 12h ate Seg 8h)', weekendWindow.size);
    y += 4;

    sectionTitle('IA vs. Humano');
    row('Atendimento 100% feito pela IA', customers100AI.length);
    row('Clientes com intervencao humana', customersWithHandoff.size);
    row('Receberam orcamento pela IA', customersWithQuote.size);
    row('Marcaram coleta pela IA', customersWithAIPickup.size);
    y += 4;

    sectionTitle('Arquivos Enviados');
    row('Comprovantes PIX (documentos)', customersSentDoc.size);
    row('Imagens de roupas', customersSentImage.size);
    y += 4;

    sectionTitle('Tempo de Resposta');
    row('Tempo medio de resposta', avgResponseSeconds != null ? `${avgResponseSeconds} segundos` : '-');
    y += 4;

    sectionTitle('Principais Duvidas dos Clientes');
    (llm.principais_duvidas || []).forEach((d, i) => {
      newPageIfNeeded(16);
      doc.setTextColor(...PURPLE); doc.setFontSize(11); doc.setFont(undefined, 'bold');
      doc.text(`${i + 1}. ${d.tema}  (~${d.contagem_aproximada})`, 18, y); y += 6;
      doc.setTextColor(...GRAY); doc.setFontSize(10); doc.setFont(undefined, 'italic');
      const ex = doc.splitTextToSize(ascii(`Ex: "${d.exemplo}"`), 170);
      doc.text(ex, 22, y); y += ex.length * 5 + 3;
    });
    y += 2;

    sectionTitle('Reclamacoes sobre o Chatbot');
    const rec = llm.reclamacoes_sobre_chatbot || {};
    row('Total de reclamacoes sobre o bot', rec.total ?? 0);
    doc.setFontSize(10); doc.setFont(undefined, 'italic'); doc.setTextColor(...GRAY);
    (rec.exemplos || []).forEach((ex) => {
      newPageIfNeeded(8);
      const lines = doc.splitTextToSize(ascii(`- "${ex}"`), 170);
      doc.text(lines, 20, y); y += lines.length * 5 + 1;
    });

    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(...GRAY);
      doc.text('Desenvolvido por gloriavirtual.com', 14, 292);
      doc.text(`Pagina ${p}/${pageCount}`, 196, 292, { align: 'right' });
    }

    const pdfBytes = doc.output('arraybuffer');
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename=relatorio-chat-5asec.pdf'
      }
    });
  } catch (error) {
    console.error('chatReportPdf error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});