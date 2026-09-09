import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const webhookUrl = Deno.env.get('MAKE_VIDEO_WEBHOOK_URL') || 'https://hook.us1.make.com/575q14uurl5jlkhbyqbqeb954qa3aazt';

    const { image_url, caption, prompt = '', reference_image_urls = [] } = await req.json();

    if (!image_url) {
      return Response.json({ error: 'image_url é obrigatório' }, { status: 400 });
    }

    if (!caption?.trim()) {
      return Response.json({ error: 'caption é obrigatório' }, { status: 400 });
    }

    const finalPrompt = `${prompt}\n\nCRITICAL VIDEO INSTRUCTIONS: Maintain absolute consistency of the character's clothing, face, and accessories throughout the entire video. Do not change the outfit, do not add or remove layers (like jackets or ties) magically. Maintain absolute consistency of the environment and props. Do not duplicate objects, do not make objects appear or disappear. The motion should be subtle and realistic, avoiding any morphing or hallucination of new elements.`;

    const payload = {
      // Campos no nível raiz (formato esperado pelo Make)
      image_url,
      caption,
      prompt: finalPrompt,
      reference_image_urls,
      // Metadados
      source: 'base44',
      type: 'generate_campaign_video',
      sent_by: user.email,
      created_at: new Date().toISOString(),
      // Mantém estrutura antiga para retrocompatibilidade
      campaign: {
        prompt: finalPrompt,
        image_url,
        caption,
        reference_image_urls,
      },
    };

    const makeResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const responseText = await makeResponse.text();
    let responseData = responseText;

    try {
      responseData = responseText ? JSON.parse(responseText) : null;
    } catch (_) {
      responseData = responseText || null;
    }

    if (!makeResponse.ok) {
      return Response.json({
        error: 'Webhook do Make retornou erro',
        details: responseData,
      }, { status: 502 });
    }

    return Response.json({
      success: true,
      make_response: responseData,
    });
  } catch (error) {
    console.error('Error in sendCampaignVideoToMake:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});