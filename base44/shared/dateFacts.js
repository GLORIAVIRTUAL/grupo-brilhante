// FATOS DETERMINÍSTICOS de data/feriado/prazo (extraído do orchestrator para reduzir seu tamanho).
// Retorna { content, deliveryDateLabel } — content vai como system message para a IA.

const HOLIDAYS_FIXED = {
    '01-01': 'Ano Novo',
    '02-02': 'Dia de Navegantes (POA)',
    '21-04': 'Tiradentes',
    '01-05': 'Dia do Trabalhador',
    '07-09': 'Independência',
    '20-09': 'Revolução Farroupilha',
    '12-10': 'Nossa Senhora Aparecida',
    '02-11': 'Finados',
    '15-11': 'Proclamação da República',
    '25-12': 'Natal'
};

const HOLIDAYS_MOBILE = {
    '2026-02-16': 'Carnaval',
    '2026-02-17': 'Carnaval',
    '2026-04-03': 'Sexta-feira Santa',
    '2026-06-04': 'Corpus Christi'
};

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const pad = (n) => String(n).padStart(2, '0');

const isBusinessDay = (d) => {
    if (d.getDay() === 0) return false;
    const ddmm = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
    const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return !HOLIDAYS_FIXED[ddmm] && !HOLIDAYS_MOBILE[ymd];
};

export const buildDateFacts = () => {
    const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const ddmm = (d) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
    const label = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

    const todayHoliday = HOLIDAYS_FIXED[ddmm(now)] || HOLIDAYS_MOBILE[key(now)];
    const tomorrowHoliday = HOLIDAYS_FIXED[ddmm(tomorrow)] || HOLIDAYS_MOBILE[key(tomorrow)];

    const deliveryDate = new Date(now);
    let added = 0;
    while (added < 3) {
        deliveryDate.setDate(deliveryDate.getDate() + 1);
        if (isBusinessDay(deliveryDate)) added++;
    }
    const deliveryDateLabel = `${WEEKDAYS[deliveryDate.getDay()]}, ${pad(deliveryDate.getDate())}/${pad(deliveryDate.getMonth() + 1)}/${deliveryDate.getFullYear()}`;

    // Prazo (3 dias úteis) a partir de QUALQUER data de recebimento — evita a IA inventar "fica pronto no mesmo dia".
    const readyFrom = (base) => {
        const d = new Date(base);
        let n = 0;
        while (n < 3) {
            d.setDate(d.getDate() + 1);
            if (isBusinessDay(d)) n++;
        }
        return `${WEEKDAYS[d.getDay()]} ${label(d)}`;
    };

    // Calendário determinístico dos próximos 30 dias — evita a IA "adivinhar" o dia da semana de datas futuras.
    const calendarLines = [];
    const blockedDates = [];
    for (let i = 0; i <= 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        const holiday = HOLIDAYS_FIXED[ddmm(d)] || HOLIDAYS_MOBILE[key(d)];
        let note;
        if (holiday) {
            note = `FERIADO (${holiday}) — loja FECHADA, PROIBIDO coleta`;
            blockedDates.push(`${label(d)} (feriado ${holiday})`);
        } else if (d.getDay() === 0) {
            note = 'domingo — loja FECHADA, PROIBIDO coleta';
            blockedDates.push(`${label(d)} (domingo)`);
        } else if (d.getDay() === 6) {
            note = 'sábado — loja ABERTA e HÁ coleta SÓ pela manhã (9h às 12h), sem turno da tarde';
        } else {
            note = 'dia útil — coleta manhã (8h-12h) ou tarde (13h-16h)';
        }
        calendarLines.push(`- ${label(d)} = ${WEEKDAYS[d.getDay()]} → ${note} | se a peça entrar neste dia, fica pronta em ${readyFrom(d)}`);
    }

    // Próxima ocorrência de cada dia da semana (ex: "segunda que vem") — evita a IA escolher a semana errada.
    const nextWeekdayLines = [];
    for (let wd = 0; wd <= 6; wd++) {
        const d = new Date(now);
        d.setDate(d.getDate() + (((wd - now.getDay()) + 7) % 7 || 7));
        const holiday = HOLIDAYS_FIXED[ddmm(d)] || HOLIDAYS_MOBILE[key(d)];
        const blocked = holiday ? `feriado ${holiday}` : (d.getDay() === 0 ? 'domingo' : null);
        let extra = '';
        if (blocked) {
            const alt = new Date(d);
            do { alt.setDate(alt.getDate() + 7); } while (!isBusinessDay(alt));
            extra = ` → SEM COLETA (${blocked}). Próxima ${WEEKDAYS[wd]} disponível: ${label(alt)}`;
        }
        nextWeekdayLines.push(`- "${WEEKDAYS[wd]} que vem" / "próxima ${WEEKDAYS[wd]}" = ${label(d)}${extra}`);
    }

    const content = `DATA E HORA ATUAL DO SISTEMA: ${dateFormatter.format(new Date())} (fuso UTC-3 Brasília).

FATOS DETERMINÍSTICOS SOBRE FERIADOS (calculados pelo sistema, use SEMPRE estes — NÃO calcule por conta própria):
- HOJE é ${WEEKDAYS[now.getDay()]}, ${label(now)}. ${todayHoliday ? `HOJE É FERIADO: ${todayHoliday}. A loja está FECHADA hoje.` : 'HOJE NÃO É FERIADO. A loja está aberta normalmente (respeitando horário comercial).'}
- AMANHÃ é ${WEEKDAYS[tomorrow.getDay()]}, ${label(tomorrow)}. ${tomorrowHoliday ? `AMANHÃ É FERIADO: ${tomorrowHoliday}. A loja estará FECHADA amanhã.` : 'AMANHÃ NÃO É FERIADO. A loja abrirá normalmente.'}

PRAZO DE ENTREGA (USE SEMPRE — NÃO RECALCULE): Prazo padrão = 3 dias úteis (seg-sáb, exceto feriados; domingos não contam). Se recebermos a roupa HOJE, fica pronta em ${deliveryDateLabel}. Se o cliente perguntar quando fica pronta ou se fica pronta em tal dia, responda DIRETAMENTE com base nessa data — NUNCA transfira para humano por causa do prazo. Use 'request_urgent_delivery' apenas se o cliente disser explicitamente que precisa antes desse prazo.

REGRA CRÍTICA: NUNCA, em hipótese alguma, diga que um dia é feriado se os FATOS acima dizem "NÃO É FERIADO". Confie APENAS nos fatos acima.

Se o cliente pedir agendamento para uma data que seja feriado, recuse educadamente e sugira outra data.

CALENDÁRIO DETERMINÍSTICO DOS PRÓXIMOS 30 DIAS (dia da semana JÁ CALCULADO pelo sistema — é PROIBIDO deduzir o dia da semana de uma data por conta própria; use SEMPRE esta lista):
${calendarLines.join('\n')}

🚨 RESOLUÇÃO DETERMINÍSTICA DE DIAS DA SEMANA (use SEMPRE esta lista, NUNCA calcule):
${nextWeekdayLines.join('\n')}
REGRA INVIOLÁVEL: quando o cliente disser um dia da semana (ex: "segunda que vem", "na quarta"), use EXATAMENTE a data desta lista. Se essa data estiver marcada como SEM COLETA, é OBRIGATÓRIO avisar o cliente explicitamente o motivo e a data original (ex: "dia 07/09 é feriado da Independência e não temos coleta") ANTES de propor a alternativa, e CONFIRMAR com ele antes de agendar. É PROIBIDO agendar silenciosamente em outra data sem explicar.

🚨 DATAS EM QUE É PROIBIDO OFERECER, SUGERIR OU AGENDAR COLETA (loja fechada):
${blockedDates.join(' | ')}
REGRA INVIOLÁVEL: é TERMINANTEMENTE PROIBIDO oferecer, sugerir, perguntar "pode ser?" ou agendar coleta em QUALQUER data desta lista, inclusive quando o cliente pedir "amanhã" e amanhã cair nessa lista. Nesse caso responda que nesse dia não há coleta e ofereça a PRÓXIMA data válida do calendário acima. NUNCA use os horários de sábado (9h-12h) para um domingo.

🚨 PRAZO DE ENTREGA A PARTIR DE UMA DATA FUTURA (REGRA INVIOLÁVEL): quando o cliente disser que vai trazer/entregar a roupa em um dia futuro (ex: "se eu levar na terça"), o prazo NÃO é o mesmo dia — use EXATAMENTE a data "fica pronta em ..." da linha daquele dia no calendário acima. É TERMINANTEMENTE PROIBIDO dizer que a peça fica pronta no MESMO dia em que entra, ou em menos de 3 dias úteis, salvo urgência tratada por 'request_urgent_delivery'.

🚨 HORÁRIO DA LOJA CONFORME O DIA DE HOJE (REGRA INVIOLÁVEL): hoje é ${WEEKDAYS[now.getDay()]}. Ao informar o horário de funcionamento, use SOMENTE a faixa correspondente a este dia da semana na tabela de lojas. Se hoje for SÁBADO, é PROIBIDO citar o horário de segunda a sexta (ex: "aberto até as 19h") — use a faixa de sábado da loja (Rio Branco e Petrópolis fecham às 14h no sábado). Aos SÁBADOS não há serviço de PASSADORIA — só lavagem; avise o cliente quando ele pedir passadoria no sábado.

REGRA CRÍTICA: SÁBADO NÃO É DIA FECHADO. Aos sábados a loja funciona e HÁ coleta no turno da manhã (9h às 12h). É TERMINANTEMENTE PROIBIDO dizer ao cliente que a loja está fechada no sábado ou que não há coleta no sábado. Só existem dias sem coleta: domingos e feriados listados acima.`;

    return { content, deliveryDateLabel };
};