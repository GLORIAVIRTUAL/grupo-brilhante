import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'userPerformanceReportPdf' });
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

    const [users, pickups, payments, quotes, conversations] = await Promise.all([
      fetchAll('User'),
      fetchAll('Pickup'),
      fetchAll('Payment'),
      fetchAll('Quote'),
      fetchAll('Conversation')
    ]);

    // Build per-user stats keyed by created_by_id
    const userMap = {};
    for (const u of users) {
      userMap[u.id] = {
        name: u.full_name || u.email || 'Sem nome',
        role: u.role || 'user',
        manualPickups: 0,
        aiPickups: 0,
        salesCount: 0,
        salesAmount: 0,
        quotesCreated: 0,
        handoffsHandled: 0
      };
    }
    const ensure = (id) => {
      if (!id) return null;
      if (!userMap[id]) {
        userMap[id] = { name: 'Usuario removido', role: '-', manualPickups: 0, aiPickups: 0, salesCount: 0, salesAmount: 0, quotesCreated: 0, handoffsHandled: 0 };
      }
      return userMap[id];
    };

    let totalAiPickups = 0;
    for (const p of pickups) {
      if (p.source === 'ai') { totalAiPickups++; continue; }
      const u = ensure(p.created_by_id);
      if (u) u.manualPickups++;
    }

    for (const pay of payments) {
      if (pay.status !== 'succeeded') continue;
      const u = ensure(pay.created_by_id);
      if (u) { u.salesCount++; u.salesAmount += Number(pay.amount) || 0; }
    }

    for (const q of quotes) {
      const u = ensure(q.created_by_id);
      if (u) u.quotesCreated++;
    }

    let totalHandoffs = 0;
    for (const c of conversations) {
      if (!c.handoff_required) continue;
      totalHandoffs++;
      const u = ensure(c.created_by_id);
      if (u) u.handoffsHandled++;
    }

    const rows = Object.values(userMap)
      .filter(u => u.manualPickups || u.salesCount || u.quotesCreated || u.handoffsHandled)
      .sort((a, b) => b.salesAmount - a.salesAmount);

    // ===== BUILD PDF =====
    const ascii = (str) => String(str ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x00-\x7F]/g, '');

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
    doc.text('Performance de Usuarios - 5asec', 14, 16);
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 14, 25);
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

    sectionTitle('Resumo Geral');
    row('Total de membros da equipe', users.length);
    row('Usuarios com atividade', rows.length);
    row('Coletas agendadas pela IA', totalAiPickups);
    row('Total de atendimentos humanos (handoff)', totalHandoffs);
    y += 4;

    sectionTitle('Performance por Usuario');
    doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(...PURPLE);
    const cols = { name: 18, pickups: 96, sales: 124, amount: 150, quotes: 172, handoff: 192 };
    const header = () => {
      newPageIfNeeded(10);
      doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(...PURPLE);
      doc.text('Usuario', cols.name, y);
      doc.text('Coletas', cols.pickups, y, { align: 'right' });
      doc.text('Vendas', cols.sales, y, { align: 'right' });
      doc.text('R$', cols.amount, y, { align: 'right' });
      doc.text('Orcam.', cols.quotes, y, { align: 'right' });
      doc.text('Atend.', cols.handoff, y, { align: 'right' });
      doc.setDrawColor(...ORANGE); doc.line(18, y + 1.5, 196, y + 1.5);
      y += 6;
    };
    header();
    doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
    rows.forEach((u) => {
      newPageIfNeeded(7);
      if (y === 20) header();
      doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
      doc.text(String(u.name).slice(0, 28), cols.name, y);
      doc.text(String(u.manualPickups), cols.pickups, y, { align: 'right' });
      doc.text(String(u.salesCount), cols.sales, y, { align: 'right' });
      doc.text(u.salesAmount.toFixed(0), cols.amount, y, { align: 'right' });
      doc.text(String(u.quotesCreated), cols.quotes, y, { align: 'right' });
      doc.text(String(u.handoffsHandled), cols.handoff, y, { align: 'right' });
      doc.setDrawColor(235, 235, 235); doc.line(18, y + 1.5, 196, y + 1.5);
      y += 6;
    });

    if (rows.length === 0) {
      doc.setFontSize(10); doc.setTextColor(...GRAY); doc.setFont(undefined, 'italic');
      doc.text('Nenhuma atividade registrada por usuario.', 18, y); y += 8;
    }

    y += 6;
    doc.setFontSize(8); doc.setFont(undefined, 'italic'); doc.setTextColor(...GRAY);
    const note = doc.splitTextToSize(ascii('Nota: "Coletas" e "Vendas" sao contabilizadas por quem criou o registro no sistema. Coletas feitas pela IA sao somadas separadamente no resumo. "Atend." conta conversas que precisaram de atendimento humano (handoff).'), 178);
    doc.text(note, 18, y);

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
        'Content-Disposition': 'attachment; filename=relatorio-performance-usuarios-5asec.pdf'
      }
    });
  } catch (error) {
    console.error('userPerformanceReportPdf error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});