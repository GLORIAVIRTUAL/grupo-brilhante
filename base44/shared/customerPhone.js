// Normalização canônica de telefone brasileiro — chave única para encontrar/salvar
// clientes sem gerar duplicados (com ou sem o "9" extra dos celulares).
export const canonicalPhone = (raw) => {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') d = d.substring(0, 4) + d.substring(5);
  return d;
};

export const isPlaceholderName = (name) => {
  const n = String(name || '').trim();
  return !n || n === 'Novo Cliente' || n === 'Cliente' ||
    n.toLowerCase().includes('@lid') || n.toLowerCase().includes('@s.whatsapp.net') ||
    /^\+?\d{8,}$/.test(n.replace(/\s/g, ''));
};