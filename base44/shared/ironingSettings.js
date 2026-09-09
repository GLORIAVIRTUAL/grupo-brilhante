// Passadoria avulsa (só passar, sem lavar): percentual configurável nas Configurações.
// Fonte da verdade = entidade IroningSettings. Fallback = 70% / Seg a Sex.

export const IRONING_DEFAULTS = { percent: 70, days_label: 'Segunda a Sexta', active: true };

export const loadIroningSettings = async (base44) => {
    try {
        const rows = await base44.asServiceRole.entities.IroningSettings.list('-updated_date', 1);
        const row = rows?.[0];
        if (!row) return { ...IRONING_DEFAULTS };
        return {
            percent: Number(row.percent) > 0 ? Number(row.percent) : IRONING_DEFAULTS.percent,
            days_label: row.days_label || IRONING_DEFAULTS.days_label,
            active: row.active !== false
        };
    } catch {
        return { ...IRONING_DEFAULTS };
    }
};

export const IRONING_RULE = (percent = 70) => `🚨 PASSADORIA AVULSA (SÓ PASSAR, SEM LAVAR): o valor é ${percent}% do valor da lavagem da MESMA peça no catálogo. A passadoria é feita SOMENTE DE SEGUNDA A SEXTA-FEIRA — NÃO há passadoria aos SÁBADOS, domingos e feriados. É TERMINANTEMENTE PROIBIDO agendar, prometer ou dizer que se passa roupa no sábado.`;