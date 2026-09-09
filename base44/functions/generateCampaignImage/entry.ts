import { enforceExistingUserSecurity } from '../../shared/functionSecurity.js';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { Buffer } from 'node:buffer';

async function urlToInlinePart(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Falha ao baixar imagem de referência: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = await response.arrayBuffer();
  const base64Data = Buffer.from(buffer).toString('base64');

  return {
    inline_data: {
      mime_type: contentType,
      data: base64Data
    }
  };
}

async function uploadBase64Image(base44, base64Data, mimeType) {
  const buffer = Buffer.from(base64Data, 'base64');
  const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const file = new File([buffer], `campaign-base-${Date.now()}.${extension}`, { type: mimeType });
  const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({ file });
  return file_url;
}

function parseGeminiJson(data) {
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') {
    throw new Error('O conteúdo da campanha foi bloqueado pelos filtros de segurança do Gemini.');
  }

  let text = candidate?.content?.parts?.find((part) => part.text)?.text;
  if (!text) {
    console.error('Gemini response missing text:', JSON.stringify(data));
    throw new Error('O Gemini não retornou um plano válido.');
  }

  text = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(text);

  if (!parsed.art_prompt || !parsed.instagram_caption) {
    throw new Error('O plano da campanha veio incompleto.');
  }

  return parsed;
}

function parseGeminiImage(data) {
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'SAFETY') {
    throw new Error('A imagem foi bloqueada pelos filtros de segurança do Gemini.');
  }

  const imagePart = candidate?.content?.parts?.find((part) => part.inlineData || part.inline_data);
  const inlineImage = imagePart?.inlineData || imagePart?.inline_data;

  if (!inlineImage?.data) {
    console.error('Gemini image response missing inline image:', JSON.stringify(data));
    throw new Error('O Gemini não retornou uma imagem válida.');
  }

  return {
    base64Data: inlineImage.data,
    mimeType: inlineImage.mimeType || inlineImage.mime_type || 'image/png'
  };
}

async function generateCampaignPlan(apiKey, prompt, reference_image_urls) {
  const imageParts = await Promise.all(reference_image_urls.slice(0, 6).map(urlToInlinePart));

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            ...imageParts,
            {
              text: `Briefing da campanha: ${prompt}

Analise o briefing e as imagens de referência para criar uma ARTE PUBLICITÁRIA COMPLETA da 5àsec, não apenas fundo.
A arte final deve aproveitar claramente as referências enviadas: estilo visual, enquadramento, direção de arte, poses, composição, clima, cores, tipografia, blocos de oferta e sensação premium.

Quero um plano em JSON com 2 saídas:
1. art_prompt: em INGLÊS, extremamente detalhado, para um modelo de image editing criar a ARTE FINAL COMPLETA em retrato 9:16 usando as referências como base visual.
2. instagram_caption: em português do Brasil.

Regras obrigatórias para art_prompt:
- create a complete premium promotional poster, not just background
- strongly preserve and reinterpret the uploaded references
- keep the same advertising language and layout feeling from the references
- include polished Portuguese promotional text inside the artwork when appropriate
- if the briefing asks for offer text, integrate it as part of the design itself
- premium Brazilian fashion/laundry advertising aesthetic
- elegant composition, strong hierarchy, realistic people and objects
- high-end typography, offer box, CTA area, price or discount highlight when relevant
- avoid distorted anatomy, broken hands, warped objects, gibberish, random letters and low-quality layouts
- output should look like a ready-to-post campaign creative
- DO NOT add white borders, letterboxing, or solid color blocks to fill space. The artwork MUST naturally fill the entire 9:16 vertical canvas.

Responda exatamente neste formato JSON:
{
  "art_prompt": "...",
  "instagram_caption": "..."
}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Erro ao gerar o plano da campanha');
  }

  return parseGeminiJson(data);
}

async function generateCampaignArt(apiKey, artPrompt, reference_image_urls) {
  const imageParts = await Promise.all(reference_image_urls.slice(0, 3).map(urlToInlinePart));

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            ...imageParts,
            {
              text: `${artPrompt}\n\nCreate one final vertical 9:16 ad creative ready for publishing. Respect the uploaded references strongly.`
            }
          ]
        }
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '9:16'
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Erro ao gerar imagem com Gemini.');
  }

  return parseGeminiImage(data);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    await enforceExistingUserSecurity(base44, req, user, { source: 'generateCampaignImage' });
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, reference_image_urls = [] } = await req.json();

    if (!prompt?.trim()) {
      return Response.json({ error: 'Prompt é obrigatório' }, { status: 400 });
    }

    if (!reference_image_urls.length) {
      return Response.json({ error: 'Envie ao menos 1 imagem de referência para gerar a arte.' }, { status: 400 });
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      return Response.json({ error: 'Chave do Gemini não configurada' }, { status: 500 });
    }

    // Use the user's prompt DIRECTLY for image generation (only generate caption via plan)
    const campaignPlan = await generateCampaignPlan(geminiKey, prompt, reference_image_urls);
    const { base64Data, mimeType } = await generateCampaignArt(geminiKey, prompt, reference_image_urls);
    const imageUrl = await uploadBase64Image(base44, base64Data, mimeType);

    return Response.json({
      image_url: imageUrl,
      model_text: campaignPlan.instagram_caption
    });
  } catch (error) {
    console.error('Error in generateCampaignImage:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});