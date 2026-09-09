function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const DELIVERY_LABELS = { counter_pickup: 'Retirada no balcão', courier_delivery: 'Entrega por motorista', locker_pickup: 'Retirada em locker', other: 'Outro' };

export function buildDeliveryReceiptHtml({ receipt, garments = [], customerName = 'Cliente' }) {
  const deliveredAt = receipt.delivered_at ? new Date(receipt.delivered_at).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>${escapeHtml(receipt.receipt_number)}</title><style>
  @page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{width:72mm;margin:0 auto;color:#111;font-family:Arial,sans-serif;font-size:10px}.brand{text-align:center;font-size:15px;font-weight:900}.muted{color:#555}.rule{border-top:1px dashed #333;margin:9px 0}.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.item{padding:6px 0;border-bottom:1px dotted #aaa}.code{font-family:monospace;font-weight:700}.alert{border:1px solid #111;padding:6px;margin-top:8px;font-weight:700}.signature{height:32px;border-bottom:1px solid #333;margin-top:22px;text-align:center}.center{text-align:center}@media screen{body{margin:20px auto;padding:10px;box-shadow:0 2px 14px #0003}}</style></head><body>
  <div class="brand">GLÓRIA LAUNDRY 5àSec</div><div class="center muted">Comprovante de ${receipt.delivery_scope === 'partial' ? 'entrega parcial' : 'entrega'}</div>
  <div class="rule"></div><div class="row"><strong>Número</strong><span class="code">${escapeHtml(receipt.receipt_number)}</span></div><div class="row"><strong>Data</strong><span>${escapeHtml(deliveredAt)}</span></div><div class="row"><strong>Cliente</strong><span>${escapeHtml(customerName)}</span></div><div class="row"><strong>Recebedor</strong><span>${escapeHtml(receipt.recipient_name)}</span></div>${receipt.recipient_document_last4 ? `<div class="row"><strong>Documento</strong><span>final ${escapeHtml(receipt.recipient_document_last4)}</span></div>` : ''}
  <div class="rule"></div><strong>Peças entregues (${garments.length})</strong>${garments.map((garment) => `<div class="item"><div class="row"><span>${escapeHtml(garment.product_name)}</span><strong>${escapeHtml(money(garment.total_amount || garment.subtotal))}</strong></div><div class="code">${escapeHtml(garment.garment_code)}</div><div class="muted">${escapeHtml((garment.services || []).map((service) => service.name).filter(Boolean).join(' + ') || 'Serviço conforme ticket')}</div></div>`).join('')}
  <div class="rule"></div><div class="row"><strong>Valor das peças</strong><strong>${escapeHtml(money(receipt.delivered_value))}</strong></div><div class="row"><strong>Tipo</strong><span>${escapeHtml(DELIVERY_LABELS[receipt.delivery_type] || receipt.delivery_type || 'Entrega')}</span></div>
  ${receipt.released_with_outstanding_balance ? `<div class="alert">LIBERADO COM SALDO EM ABERTO: ${escapeHtml(money(receipt.outstanding_value_at_delivery))}<br/>Motivo: ${escapeHtml(receipt.release_reason)}</div>` : ''}
  <div class="signature">Assinatura do recebedor</div><p class="center muted">Guarde este comprovante. As demais peças, quando houver, permanecem vinculadas ao ticket.</p>
  </body></html>`;
}

export function printDeliveryReceipt(payload, targetWindow) {
  const printWindow = targetWindow || window.open('', '_blank', 'width=620,height=760');
  if (!printWindow) throw new Error('print_window_blocked');
  printWindow.document.open();
  printWindow.document.write(buildDeliveryReceiptHtml(payload));
  printWindow.document.close();
  window.setTimeout(() => { printWindow.focus(); printWindow.print(); }, 250);
}
