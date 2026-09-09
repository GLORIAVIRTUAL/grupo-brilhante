import QRCode from 'qrcode';

export function garmentQrPayload(garment) {
  return `GLORIA|GARMENT|${garment.garment_code}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function serviceText(garment) {
  const services = (garment.services || []).map((service) => service.name).filter(Boolean);
  return services.length > 0 ? services.join(' + ') : 'Serviço conforme ticket';
}

function attributeText(garment) {
  const attributes = garment.attributes || {};
  return [attributes.color, attributes.brand, attributes.size, attributes.material].filter(Boolean).join(' · ');
}

export async function buildGarmentLabelHtml(garments) {
  const labels = await Promise.all(garments.map(async (garment) => ({
    garment,
    qr: await QRCode.toDataURL(garmentQrPayload(garment), {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 260,
      color: { dark: '#000000', light: '#ffffff' },
    }),
  })));

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Etiquetas de peças</title>
<style>
  @page { size: 62mm 40mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #000; font-family: Inter, Arial, sans-serif; }
  .label { width: 62mm; height: 40mm; padding: 2.2mm; display: grid; grid-template-columns: 24mm 1fr; gap: 2mm; page-break-after: always; overflow: hidden; }
  .label:last-child { page-break-after: auto; }
  .qr { width: 23mm; height: 23mm; display: block; }
  .brand { font-weight: 900; font-size: 9pt; letter-spacing: .2pt; line-height: 1; }
  .code { margin-top: 1mm; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8pt; font-weight: 800; word-break: break-all; }
  .ticket { margin-top: .7mm; font-size: 7pt; }
  .product { margin-top: 1.2mm; font-size: 9pt; font-weight: 900; line-height: 1.05; }
  .detail { margin-top: .8mm; font-size: 6.5pt; line-height: 1.15; }
  .footer { align-self: end; border-top: .3mm solid #000; padding-top: .6mm; font-size: 5.5pt; font-weight: 700; }
  @media screen { body { background: #ddd; padding: 12px; } .label { margin: 0 auto 12px; background: #fff; box-shadow: 0 2px 10px #0003; } }
</style>
</head>
<body>
${labels.map(({ garment, qr }) => `<section class="label">
  <div><img class="qr" src="${qr}" alt="QR ${escapeHtml(garment.garment_code)}" /><div class="code">${escapeHtml(garment.garment_code)}</div></div>
  <div style="display:flex;flex-direction:column;min-width:0">
    <div class="brand">GLÓRIA LAUNDRY 5àSec</div>
    <div class="ticket">Ticket: ${escapeHtml(garment.ticket_number || garment.order_id?.slice(-8) || '—')}</div>
    <div class="product">${escapeHtml(garment.product_name || 'Peça')}</div>
    <div class="detail">${escapeHtml(attributeText(garment) || 'Sem características adicionais')}</div>
    <div class="detail"><strong>Serviços:</strong> ${escapeHtml(serviceText(garment))}</div>
    <div class="footer">Leia o QR para movimentar, localizar ou entregar</div>
  </div>
</section>`).join('')}
</body>
</html>`;
}

export async function printGarmentLabels(garments, targetWindow) {
  if (!Array.isArray(garments) || garments.length === 0) throw new Error('garments_required');
  const printWindow = targetWindow || window.open('', '_blank', 'width=840,height=680');
  if (!printWindow) throw new Error('print_window_blocked');
  printWindow.document.open();
  printWindow.document.write('<!doctype html><title>Preparando etiquetas</title><body style="font-family:Arial;padding:32px">Preparando etiquetas com QR…</body>');
  printWindow.document.close();
  const html = await buildGarmentLabelHtml(garments);
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  await new Promise((resolve) => setTimeout(resolve, 350));
  printWindow.focus();
  printWindow.print();
  return true;
}
