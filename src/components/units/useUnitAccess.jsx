import { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { getAllowedUnitIds, hasPermission } from '@/lib/accessControl';

const UNITS_CACHE_KEY = 'cachedUnits_v2';

const getPrimaryUnitId = (user) => user?.primary_unit_id || user?.data?.primary_unit_id || '';

export const getRecordUnitId = (record) => record?.unit_id || record?.data?.unit_id || null;

export const filterRecordsByUnit = (records, selectedUnitId, fallbackUnitId) => {
  if (selectedUnitId === 'all') return records;

  return records.filter((record) => {
    const unitId = getRecordUnitId(record);
    if (unitId) return unitId === selectedUnitId;
    return fallbackUnitId ? selectedUnitId === fallbackUnitId : false;
  });
};

export const getUnitLabel = (selectedUnit, selectedUnitId) => {
  if (selectedUnitId === 'all') return 'Todas as unidades';
  return selectedUnit?.name || 'Unidade';
};

export default function useUnitAccess() {
  const [user, setUser] = useState(null);
  const [units, setUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [loading, setLoading] = useState(true);

  const loadAccess = async (forceRefresh = false) => {
    setLoading(true);
    try {
      let currentUser = null;
      const cachedUserRaw = sessionStorage.getItem('cachedUser');
      if (!forceRefresh && cachedUserRaw) {
        try {
          const parsed = JSON.parse(cachedUserRaw);
          if (parsed && Date.now() - parsed.t < 5 * 60 * 1000) currentUser = parsed.u;
        } catch (_) { /* cache inválido é ignorado */ }
      }

      if (!currentUser) {
        currentUser = await base44.auth.me();
        sessionStorage.setItem('cachedUser', JSON.stringify({ u: currentUser, t: Date.now() }));
      }
      setUser(currentUser);

      let unitsList = [];
      const cachedUnitsRaw = sessionStorage.getItem(UNITS_CACHE_KEY);
      if (!forceRefresh && cachedUnitsRaw) {
        try {
          const parsed = JSON.parse(cachedUnitsRaw);
          if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.t < 5 * 60 * 1000) unitsList = parsed.list;
        } catch (_) { /* cache inválido é ignorado */ }
      }

      if (unitsList.length === 0) {
        try {
          unitsList = await base44.entities.Unit.list('name', 100);
        } catch (error) {
          console.warn('Não foi possível carregar unidades.', error);
          unitsList = [];
        }
        if (unitsList.length > 0) {
          sessionStorage.setItem(UNITS_CACHE_KEY, JSON.stringify({ list: unitsList, t: Date.now() }));
        }
      }

      setUnits(unitsList);

      const isAdminUser = ['super_admin', 'admin'].includes(currentUser?.role);
      const allowedUnitIds = getAllowedUnitIds(currentUser);
      const allowedUnits = allowedUnitIds.includes('*')
        ? unitsList
        : unitsList.filter((unit) => allowedUnitIds.includes(unit.id));
      const effectiveUnits = allowedUnits.length > 0 ? allowedUnits : unitsList.filter((unit) => unit.id === getPrimaryUnitId(currentUser));
      const savedPrimaryUnit = effectiveUnits.find((unit) => unit.id === getPrimaryUnitId(currentUser)) || null;
      const fallbackUnit = savedPrimaryUnit || effectiveUnits[0] || unitsList[0] || null;
      const primaryUnitId = fallbackUnit?.id || '';

      setSelectedUnitId((currentValue) => {
        if (isAdminUser && (!currentValue || currentValue === 'all')) return 'all';
        if (currentValue && effectiveUnits.some((unit) => unit.id === currentValue)) return currentValue;
        return primaryUnitId;
      });
    } catch (error) {
      console.error('Erro ao carregar acesso por unidade:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAccess();
  }, []);

  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const canViewAllUnits = isAdmin || hasPermission(user, 'units.view_all');

  const accessibleUnits = useMemo(() => {
    const allowed = getAllowedUnitIds(user);
    if (allowed.includes('*')) return units;
    const filtered = units.filter((unit) => allowed.includes(unit.id));
    return filtered.length > 0 ? filtered : units.filter((unit) => unit.id === getPrimaryUnitId(user));
  }, [units, user]);

  const defaultUnitId = useMemo(() => {
    const savedPrimaryUnit = accessibleUnits.find((unit) => unit.id === getPrimaryUnitId(user)) || null;
    const fallbackUnit = savedPrimaryUnit || accessibleUnits[0] || null;
    return fallbackUnit?.id || '';
  }, [accessibleUnits, user]);

  const selectedUnit = units.find((unit) => unit.id === selectedUnitId) || null;

  return {
    user,
    units,
    accessibleUnits,
    isAdmin,
    canViewAllUnits,
    selectedUnit,
    selectedUnitId,
    setSelectedUnitId,
    defaultUnitId,
    loading,
    reloadAccess: () => loadAccess(true)
  };
}