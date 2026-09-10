// Justificativa automática para a trilha de auditoria, usada onde o campo
// manual foi removido das telas de cadastro e operação.
export function autoReason(action) {
  return `${action} registrado pelo painel administrativo`;
}