import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    await enforceExistingUserSecurity(base44, req, user, { source: 'pickupsReportPdf' });
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

    const [pickups, customers] = await Promise.all([
      fetchAll('Pickup'),
      fetchAll('Customer')
    ]);

    const customerMap = {};
    for (const c of customers) customerMap[c.id] = c.full_name || 'Desconhecido';

    // ===== AGGREGATIONS =====
    let firstDate = null, lastDate = null;
    const byNeighborhood = {};
    const byCustomer = {};
    const byStatus = {};
    const byType = {};
    const byWeekday = {};
    let aiCount = 0, humanCount = 0;
    let freeCount = 0, paidCount = 0;
    let priorityCount = 0;
    let totalFee = 0;

    const weekdayNames = ['Domingo', 'Segunda', 'Terca', 'Quarta', 'Quinta', 'Sexta', 'Sabado'];

    for (const p of pickups) {
      const ref = p.scheduled_at || p.created_date;
      if (ref) {
        const d = new Date(ref);
        if (!firstDate || d < firstDate) firstDate = d;
        if (!lastDate || d > lastDate) lastDate = d;
        const weekdayKey = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Sao_Paulo',
          weekday: 'short'
        }).format(d);
        const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayKey];
        const dn = weekdayNames[weekdayIndex];
        byWeekday[dn] = (byWeekday[dn] || 0) + 1;
      }

      const hood = p.neighborhood || 'Nao Informado';
      byNeighborhood[hood] = (byNeighborhood[hood] || 0) + 1;

      const custName = customerMap[p.customer_id] || 'Desconhecido';
      byCustomer[custName] = (byCustomer[custName] || 0) + 1;

      const status = p.status || 'scheduled';
      byStatus[status] = (byStatus[status] || 0) + 1;

      const type = p.type || 'regular';
      byType[type] = (byType[type] || 0) + 1;

      if (p.source === 'ai') aiCount++; else humanCount++;

      const fee = Number(p.fee) || 0;
      if (fee > 0) { paidCount++; totalFee += fee; } else freeCount++;

      if (p.priority) priorityCount++;
    }

    const topN = (obj, n = 10) => Object.entries(obj)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n);

    const topNeighborhoods = topN(byNeighborhood, 10);
    const topCustomers = topN(byCustomer, 10);

    const statusLabels = { scheduled: 'Agendadas', completed: 'Concluidas', cancelled: 'Canceladas', missed: 'Perdidas' };
    const typeLabels = { regular: 'Regular', fixed: 'Fixa', extra: 'Encaixe' };

    // ===== BUILD PDF =====
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
    doc.text('Relatorio de Coletas - 5asec', 14, 16);
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
    row('Total de coletas agendadas', pickups.length);
    row('Clientes unicos com coleta', Object.keys(byCustomer).length);
    row('Bairros atendidos', Object.keys(byNeighborhood).length);
    row('Coletas prioritarias', priorityCount);
    y += 4;

    sectionTitle('Origem do Agendamento');
    row('Feitas pela IA (Gloria)', aiCount);
    row('Feitas manualmente (humano)', humanCount);
    y += 4;

    sectionTitle('Taxas de Coleta');
    row('Coletas gratis', freeCount);
    row('Coletas pagas', paidCount);
    row('Total arrecadado em taxas', `R$ ${totalFee.toFixed(2)}`);
    y += 4;

    sectionTitle('Status das Coletas');
    Object.entries(byStatus).forEach(([k, v]) => row(statusLabels[k] || k, v));
    y += 4;

    sectionTitle('Tipos de Coleta');
    Object.entries(byType).forEach(([k, v]) => row(typeLabels[k] || k, v));
    y += 4;

    sectionTitle('Top 10 Bairros');
    topNeighborhoods.forEach((item, i) => row(`${i + 1}. ${item.name}`, item.value));
    y += 4;

    sectionTitle('Top 10 Clientes');
    topCustomers.forEach((item, i) => row(`${i + 1}. ${item.name}`, item.value));
    y += 4;

    sectionTitle('Coletas por Dia da Semana');
    weekdayNames.forEach((dn) => { if (byWeekday[dn]) row(dn, byWeekday[dn]); });

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
        'Content-Disposition': 'attachment; filename=relatorio-coletas-5asec.pdf'
      }
    });
  } catch (error) {
    console.error('pickupsReportPdf error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});