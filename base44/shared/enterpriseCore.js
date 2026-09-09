export function normalizeEnterpriseCode(value, maxLength = 40) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function allDigitsEqual(value) {
  return value.split('').every((char) => char === value[0]);
}

export function isValidCpf(value) {
  const cpf = digits(value);
  if (cpf.length !== 11 || allDigitsEqual(cpf)) return false;
  const calculate = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(cpf[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return calculate(9) === Number(cpf[9]) && calculate(10) === Number(cpf[10]);
}

export function isValidCnpj(value) {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || allDigitsEqual(cnpj)) return false;
  const calculate = (base, weights) => {
    const sum = base.split('').reduce((total, char, index) => total + Number(char) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(`${cnpj.slice(0, 12)}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(cnpj[12]) && second === Number(cnpj[13]);
}

export function validateTaxId(value, type = 'company') {
  const normalized = digits(value);
  if (type === 'person') return { valid: isValidCpf(normalized), normalized, type: 'cpf' };
  if (type === 'company') return { valid: isValidCnpj(normalized), normalized, type: 'cnpj' };
  if (normalized.length === 11) return { valid: isValidCpf(normalized), normalized, type: 'cpf' };
  if (normalized.length === 14) return { valid: isValidCnpj(normalized), normalized, type: 'cnpj' };
  return { valid: false, normalized, type: 'unknown' };
}

export function normalizeIntegrationStatus(value) {
  const allowed = new Set(['disabled', 'configured', 'homologation', 'approved', 'production', 'suspended']);
  return allowed.has(value) ? value : 'disabled';
}

export function integrationCanProduceRealEffects(status) {
  return status === 'production';
}

export function sanitizeEnterprisePatch(input, allowedFields) {
  return Object.fromEntries(allowedFields
    .filter((field) => Object.prototype.hasOwnProperty.call(input || {}, field))
    .map((field) => [field, input[field]]));
}
