// Configuração de modelo/temperatura definida em Configurações > Inteligência Artificial.
// A Glória usa a API do Google Gemini (chat, ferramentas, visão e áudio).
export const DEFAULT_AI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_AI_TEMPERATURE = 0.3;

// Modelos antigos da OpenAI que possam estar salvos no banco caem no padrão Gemini.
const normalizeModel = (model) => (!model || /^(gpt|o1|o3|chatgpt)/i.test(model) ? DEFAULT_AI_MODEL : model);

export const getAiSettings = async (base44) => {
    try {
        const list = await base44.asServiceRole.entities.AiSettings.list('-created_date', 1);
        const cfg = list[0] || {};
        return {
            model: normalizeModel(cfg.model),
            temperature: typeof cfg.temperature === 'number' ? cfg.temperature : DEFAULT_AI_TEMPERATURE
        };
    } catch (error) {
        console.warn('AiSettings não carregado, usando padrão:', error?.message);
        return { model: DEFAULT_AI_MODEL, temperature: DEFAULT_AI_TEMPERATURE };
    }
};