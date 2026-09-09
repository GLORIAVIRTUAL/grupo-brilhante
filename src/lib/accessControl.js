import { ROLE_DEFINITIONS, normalizeLegacyRole } from '@/lib/roleDefinitions';

export const ROLE_PERMISSIONS = Object.fromEntries(
  Object.entries(ROLE_DEFINITIONS).map(([role, definition]) => [role, [...definition.permissions]]),
);

export function hasPermission(user, permission) {
  if (!user) return false;
  const role = normalizeLegacyRole(user.role);
  const explicitPermissions = Array.isArray(user.permissions) ? user.permissions : [];
  const effectivePermissions = Array.isArray(user.effective_permissions) ? user.effective_permissions : [];
  const rolePermissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.attendant;
  return rolePermissions.includes('*') || rolePermissions.includes(permission) || explicitPermissions.includes(permission) || effectivePermissions.includes(permission);
}

export function getAllowedUnitIds(user) {
  if (!user) return [];
  const role = normalizeLegacyRole(user.role);
  // Administradores enxergam todas as unidades da rede.
  if (role === 'super_admin' || role === 'admin' || hasPermission(user, 'units.view_all')) return ['*'];
  return [...new Set([
    user.primary_unit_id,
    ...(Array.isArray(user.allowed_unit_ids) ? user.allowed_unit_ids : []),
    ...(Array.isArray(user.effective_unit_ids) ? user.effective_unit_ids : []),
  ].filter(Boolean))];
}

export function canAccessUnit(user, unitId) {
  if (!unitId) return true;
  const allowed = getAllowedUnitIds(user);
  return allowed.includes('*') || allowed.includes(unitId);
}

export function assertPermission(user, permission) {
  if (!hasPermission(user, permission)) {
    throw Object.assign(new Error('Você não possui permissão para executar esta ação.'), { code: 'FORBIDDEN' });
  }
}