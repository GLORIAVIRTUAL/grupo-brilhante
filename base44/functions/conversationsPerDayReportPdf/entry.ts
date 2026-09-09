import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'conversationsPerDayReportPdf' });
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const DAYS = 70;
    const TZ = 'America/Sao_Paulo';
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (DAYS - 1));
    start.setHours(0, 0, 0, 0);

    // Fetch conversations created within range (paginated)
    const all = [];
    const pageSize = 500;
    let skip = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.Conversation.list('-created_date', pageSize, skip);
      if (!batch || batch.length === 0) break;
      all.push(...batch);
      const oldest = batch[batch.length - 1]?.created_date;
      if (batch.length < pageSize) break;
      if (oldest && new Date(oldest) < start) break;
      skip += pageSize;
      if (skip > 200000) break;
    }

    // Build day key (yyyy-mm-dd in TZ)
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

    // Initialize all 70 days with 0
    const counts = {};
    const order = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d);
      counts[k] = 0;
      order.push(k);
    }

    let total = 0;
    for (const c of all) {
      if (!c.created_date) continue;
      const cd = new Date(c.created_date);
      if (cd < start) continue;
      const k = dayKey(cd);
      if (k in counts) { counts[k]++; total++; }
    }

    const peak = order.reduce((m, k) => counts[k] > counts[m] ? k : m, order[0]);
    const peakValue = counts[peak] || 0;
    const avg = total / DAYS;

    // ===== PDF =====
    const ascii = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x00-\x7F]/g, '');
    const fmtBR = (k) => { const [y, m, dd] = k.split('-'); return `${dd}/${m}/${y}`; };
    const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const wd = (k) => weekdays[new Date(k + 'T12:00:00').getDay()];

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
    doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('Conversas Iniciadas por Dia - 5asec', 14, 15);
    doc.setFontSize(10); doc.setFont(undefined, 'normal');
    doc.text(`Periodo: ${fmtBR(order[0])} a ${fmtBR(order[order.length - 1])} (${DAYS} dias)`, 14, 23);
    doc.text(`Gerado em: ${new Date().toLocaleDateString('pt-BR', { timeZone: TZ })}`, 14, 29);
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

    sectionTitle('Resumo');
    row('Total de conversas iniciadas', total);
    row('Media por dia', avg.toFixed(1));
    row('Dia de pico', `${fmtBR(peak)} (${peakValue})`);
    y += 4;

    sectionTitle('Detalhamento Diario');
    const maxV = Math.max(peakValue, 1);
    const barMaxW = 90;
    doc.setFontSize(8); doc.setFont(undefined, 'bold'); doc.setTextColor(...PURPLE);
    newPageIfNeeded(8);
    doc.text('Data', 18, y);
    doc.text('Dia', 46, y);
    doc.text('Conversas', 88, y, { align: 'right' });
    doc.setDrawColor(...ORANGE); doc.line(18, y + 1.5, 196, y + 1.5);
    y += 6;

    order.forEach((k) => {
      newPageIfNeeded(6.5);
      const v = counts[k];
      doc.setFontSize(8); doc.setFont(undefined, 'normal'); doc.setTextColor(40, 40, 40);
      doc.text(fmtBR(k), 18, y);
      doc.text(wd(k), 46, y);
      doc.text(String(v), 88, y, { align: 'right' });
      // bar
      const w = (v / maxV) * barMaxW;
      doc.setFillColor(...ORANGE);
      if (w > 0) doc.rect(100, y - 3, w, 3.2, 'F');
      doc.setDrawColor(238, 238, 238); doc.line(18, y + 1.5, 196, y + 1.5);
      y += 6;
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
        'Content-Disposition': 'attachment; filename=relatorio-conversas-por-dia-5asec.pdf'
      }
    });
  } catch (error) {
    console.error('conversationsPerDayReportPdf error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});