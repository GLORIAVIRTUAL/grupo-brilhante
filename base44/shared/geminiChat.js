// Adaptador do Google Gemini com a MESMA interface que era usada da OpenAI
// (chat.completions.create → { choices: [{ message }] }), para que todo o ciclo de
// ferramentas, retries e proteções anti-alucinação do orchestrator continuem iguais.
//
// Usa a REST API oficial (generativelanguage) com a GEMINI_API_KEY dos secrets.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const apiKey = () => Deno.env.get('GEMINI_API_KEY');

export const bytesToBase64 = (bytes) => {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
};

// Converte as ferramentas no formato OpenAI ({type:'function', function:{...}})
// para functionDeclarations do Gemini, preservando nomes e argumentos.
const toGeminiTools = (tools) => {
    if (!tools || !tools.length) return undefined;
    const functionDeclarations = tools.map((t) => {
        const fn = t.function || t;
        const decl = { name: fn.name, description: fn.description };
        const params = fn.parameters;
        if (params && params.properties && Object.keys(params.properties).length > 0) {
            decl.parameters = params;
        }
        return decl;
    });
    return [{ functionDeclarations }];
};

// Converte o array de mensagens estilo OpenAI para contents + systemInstruction do Gemini.
const toGeminiContents = (messages = []) => {
    const systemParts = [];
    const contents = [];
    // tool_call_id → nome da função (o Gemini identifica a resposta da ferramenta pelo NOME).
    const callNames = new Map();

    for (const msg of messages) {
        if (msg.role === 'system') {
            if (msg.content) systemParts.push(msg.content);
            continue;
        }

        if (msg.role === 'tool') {
            const name = callNames.get(msg.tool_call_id) || 'tool_result';
            let payload;
            try {
                payload = JSON.parse(msg.content);
            } catch {
                payload = { result: msg.content };
            }
            contents.push({
                role: 'user',
                parts: [{ functionResponse: { name, response: payload } }]
            });
            continue;
        }

        if (msg.role === 'assistant') {
            const parts = [];
            if (msg.content) parts.push({ text: msg.content });
            for (const call of msg.tool_calls || []) {
                callNames.set(call.id, call.function.name);
                let args = {};
                try {
                    args = JSON.parse(call.function.arguments || '{}');
                } catch { /* argumentos inválidos → objeto vazio */ }
                parts.push({ functionCall: { name: call.function.name, args } });
            }
            if (parts.length) contents.push({ role: 'model', parts });
            continue;
        }

        // user
        if (msg.content) contents.push({ role: 'user', parts: [{ text: msg.content }] });
    }

    // O Gemini exige que a conversa comece pelo usuário.
    while (contents.length && contents[0].role === 'model') contents.shift();

    return { contents, systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined };
};

const extractMessage = (data) => {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPieces = [];
    const toolCalls = [];
    parts.forEach((part, index) => {
        if (part.text) textPieces.push(part.text);
        if (part.functionCall) {
            toolCalls.push({
                id: `call_${index}_${part.functionCall.name}`,
                type: 'function',
                function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {})
                }
            });
        }
    });

    const message = { role: 'assistant', content: textPieces.join('\n').trim() || null };
    if (toolCalls.length) message.tool_calls = toolCalls;
    return message;
};

export const geminiChat = async ({ model, temperature, messages, tools, responseJson, thinkingBudget }) => {
    const { contents, systemInstruction } = toGeminiContents(messages);
    const body = {
        contents,
        generationConfig: { temperature: typeof temperature === 'number' ? temperature : 0.3 }
    };
    // thinkingBudget = 0 desliga o "raciocínio interno" do Gemini (respostas ~4x mais rápidas).
    if (typeof thinkingBudget === 'number') body.generationConfig.thinkingConfig = { thinkingBudget };
    if (systemInstruction) body.systemInstruction = systemInstruction;
    const geminiTools = toGeminiTools(tools);
    if (geminiTools) body.tools = geminiTools;
    // responseMimeType JSON não pode ser combinado com ferramentas.
    if (responseJson && !geminiTools) body.generationConfig.responseMimeType = 'application/json';

    const url = `${API_BASE}/${model || DEFAULT_GEMINI_MODEL}:generateContent?key=${apiKey()}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 500)}`);
    }

    const data = await res.json();
    return { choices: [{ message: extractMessage(data) }] };
};

// Cliente com a mesma assinatura usada antes (openai.chat.completions.create).
export const createGeminiClient = () => ({
    chat: {
        completions: {
            create: ({ model, temperature, messages, tools, response_format }) => geminiChat({
                model,
                temperature,
                messages,
                tools,
                responseJson: response_format?.type === 'json_object'
            })
        }
    }
});

// Transcrição de áudio do WhatsApp (substitui o Whisper).
export const transcribeAudioWithGemini = async ({ base64Audio, mimeType, model }) => {
    const url = `${API_BASE}/${model || DEFAULT_GEMINI_MODEL}:generateContent?key=${apiKey()}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                role: 'user',
                parts: [
                    { text: 'Transcreva EXATAMENTE o que é dito neste áudio, em português do Brasil. Responda somente com a transcrição, sem comentários.' },
                    { inlineData: { mimeType: mimeType || 'audio/ogg', data: base64Audio } }
                ]
            }],
            generationConfig: { temperature: 0 }
        })
    });
    if (!res.ok) throw new Error(`Gemini audio error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(' ').trim();
};

// Visão: classifica imagem e devolve JSON.
export const geminiVisionJson = async ({ base64Image, mimeType, systemText, userText, model }) => {
    const url = `${API_BASE}/${model || DEFAULT_GEMINI_MODEL}:generateContent?key=${apiKey()}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents: [{
                role: 'user',
                parts: [
                    { text: userText },
                    { inlineData: { mimeType: mimeType || 'image/jpeg', data: base64Image } }
                ]
            }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json' }
        })
    });
    if (!res.ok) throw new Error(`Gemini vision error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
};