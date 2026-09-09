export function classifyConsentResponse(text) {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const accepted = ['sim', 'aceito', 'autorizo', 'concordo', 'quero receber', 'pode enviar'];
  const declined = ['nao', 'nao aceito', 'nao autorizo', 'nao quero', 'recuso'];
  if (accepted.includes(normalized)) return 'accepted';
  if (declined.includes(normalized)) return 'declined';
  return null;
}

export function hasActiveConsentRequest(customer) {
  if (customer?.whatsapp_consent_status !== 'pending' || !customer?.whatsapp_consent_requested_at) return false;
  const requestedAt = new Date(customer.whatsapp_consent_requested_at).getTime();
  return Number.isFinite(requestedAt) && Date.now() - requestedAt <= 30 * 24 * 60 * 60 * 1000;
}