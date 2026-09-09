import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

const fmtDate = (d) => (d ? format(new Date(d), 'dd/MM/yyyy HH:mm') : '—');
const money = (v) => `${Number(v || 0).toFixed(2)}`;

const STATUS_PT = {
  pending: 'Pendente',
  processing: 'Em Processo',
  ready: 'Pronto',
  delivered: 'Entregue',
  finished: 'Finalizado',
  cancelled: 'Cancelado'
};

// Dados fixos da empresa (cabeçalho do cupom)
const COMPANY = {
  name: '5 À SEC',
  slogan: 'QUALIDADE - RAPIDEZ - ECONOMIA',
  branch: '5ASEC PETRÓPOLIS',
  address: 'AV NILO PEÇANHA, 95',
  city: 'PETRÓPOLIS - PORTO ALEGRE - RS'
};

function ticketCode(order) {
  return `${order.ticket_number || (order.id || '').slice(-6)}`;
}

// Monta as linhas de cada item do pedido (com cor/tamanho/marca/estampa/obs)
function buildItemLines(items) {
  return (items || []).map((it) => {
    const qty = it.qty || 1;
    const name = (it.garment_type || it.name || 'SERVIÇO').toUpperCase();
    const lineTotal = money((it.unit_price || 0) * qty);
    const attrs = [];
    if (it.color) attrs.push(`COR: ${it.color}`);
    if (it.size) attrs.push(`TAM: ${it.size}`);
    if (it.brand) attrs.push(`MARCA: ${it.brand}`);
    if (it.pattern) attrs.push(`ESTAMPA: ${it.pattern}`);
    if (it.notes) attrs.push(it.notes);
    return { name, qty, lineTotal, attrs };
  });
}

export function printTicket(order, customerName, opts = {}) {
  const { items = [], customerPhone = '' } = opts;
  const lines = buildItemLines(items);

  const itemsHtml = lines.length
    ? lines.map((l) => `
        <div class="item">
          <span class="i-name">${l.name}</span>
          <span class="i-qty">${l.qty}x</span>
          <span class="i-val">${l.lineTotal}</span>
        </div>
        ${l.attrs.map((a) => `<div class="attr">*${a.toUpperCase()}</div>`).join('')}
      `).join('')
    : `<div class="item"><span class="i-name">SERVIÇOS DE LAVANDERIA</span><span class="i-qty"></span><span class="i-val">${money(order.total_amount)}</span></div>`;

  const totalQty = lines.reduce((s, l) => s + l.qty, 0) || lines.length || 1;

  const html = `
    <html><head><title>Ticket ${ticketCode(order)}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      * { font-family: 'Courier New', monospace; box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body { width: 80mm; padding: 2mm 3mm; color: #000; font-size: 12px; line-height: 1.35; }
      .head { text-align: center; }
      h1 { font-size: 15px; text-align: center; margin: 0 0 1mm; font-weight: bold; letter-spacing: 1px; }
      .sub { text-align: center; font-size: 11px; margin: 0; }
      .pos { text-align: center; font-size: 14px; font-weight: bold; margin: 2mm 0; }
      hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
      .line { display: flex; font-size: 11px; }
      .item { display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; margin-top: 1mm; }
      .item .i-name { flex: 1; }
      .item .i-qty { width: 28px; text-align: right; }
      .item .i-val { width: 52px; text-align: right; }
      .attr { font-size: 11px; padding-left: 2mm; }
      .totrow { display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; }
      .foot { text-align: center; font-size: 10px; margin-top: 3mm; }
    </style></head>
    <body>
      <div class="head">
        <h1>${COMPANY.name}</h1>
        <p class="sub">${COMPANY.slogan}</p>
        <p class="sub">${COMPANY.branch}</p>
        <p class="sub">${COMPANY.address}</p>
        <p class="sub">${COMPANY.city}</p>
      </div>
      <hr/>
      <div class="pos">POS: ${ticketCode(order)}</div>
      <hr/>
      <div class="line"><span>CLIENTE: ${(customerName || 'Desconhecido').toUpperCase()}</span></div>
      ${customerPhone ? `<div class="line"><span>TELEFONE: ${customerPhone}</span></div>` : ''}
      <hr/>
      ${itemsHtml}
      <hr/>
      <div class="totrow"><span>TOTAL SERVIÇOS: ${totalQty}</span><span>${money(order.total_amount)}</span></div>
      <hr/>
      <div class="line"><span>EMISSÃO: ${fmtDate(order.created_date)}</span></div>
      <div class="line"><span>RETIRADA: ${fmtDate(order.expected_finish_at)}</span></div>
      <div class="line"><span>STATUS: ${(STATUS_PT[order.status] || order.status || '—').toUpperCase()}</span></div>
      <div class="foot">Emitido em ${format(new Date(), 'dd/MM/yyyy HH:mm')}</div>
      <div class="foot">Obrigado pela preferência!</div>
      <script>window.onload = function(){ window.print(); setTimeout(function(){ window.close(); }, 300); }</script>
    </body></html>`;

  const w = window.open('', '_blank', 'width=320,height=640');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

export function downloadTicketPdf(order, customerName, opts = {}) {
  const { items = [], customerPhone = '' } = opts;
  const lines = buildItemLines(items);

  const doc = new jsPDF({ unit: 'mm', format: [80, 220] });
  const W = 80;
  const L = 4;
  const R = W - 4;
  let y = 8;

  const center = (txt, size, bold) => {
    doc.setFontSize(size);
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.text(txt, W / 2, y, { align: 'center' });
    y += size * 0.5;
  };
  const left = (txt, size, bold) => {
    doc.setFontSize(size);
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.text(txt, L, y);
    y += size * 0.5;
  };
  const rowLR = (l, r, size, bold) => {
    doc.setFontSize(size);
    doc.setFont('courier', bold ? 'bold' : 'normal');
    doc.text(l, L, y);
    doc.text(r, R, y, { align: 'right' });
    y += size * 0.5;
  };
  const dashed = () => {
    doc.setLineWidth(0.2);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(L, y, R, y);
    doc.setLineDashPattern([], 0);
    y += 3;
  };

  center(COMPANY.name, 12, true);
  center(COMPANY.slogan, 7);
  center(COMPANY.branch, 7);
  center(COMPANY.address, 7);
  center(COMPANY.city, 7);
  y += 1;
  dashed();
  center(`POS: ${ticketCode(order)}`, 11, true);
  dashed();
  left(`CLIENTE: ${(customerName || 'Desconhecido').toUpperCase()}`, 8);
  if (customerPhone) left(`TELEFONE: ${customerPhone}`, 8);
  y += 1;
  dashed();

  if (lines.length) {
    lines.forEach((l) => {
      rowLR(l.name, `${l.qty}x ${l.lineTotal}`, 8, true);
      l.attrs.forEach((a) => left(`*${a.toUpperCase()}`, 7));
    });
  } else {
    rowLR('SERVIÇOS DE LAVANDERIA', money(order.total_amount), 8, true);
  }

  const totalQty = lines.reduce((s, l) => s + l.qty, 0) || lines.length || 1;
  y += 1;
  dashed();
  rowLR(`TOTAL SERVIÇOS: ${totalQty}`, money(order.total_amount), 11, true);
  dashed();
  left(`EMISSÃO: ${fmtDate(order.created_date)}`, 8);
  left(`RETIRADA: ${fmtDate(order.expected_finish_at)}`, 8);
  left(`STATUS: ${STATUS_PT[order.status] || order.status || '—'}`, 8);
  y += 3;
  center(`Emitido em ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 7);
  center('Obrigado pela preferência!', 7);

  doc.save(`ticket-${ticketCode(order)}.pdf`);
}