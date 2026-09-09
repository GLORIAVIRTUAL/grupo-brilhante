import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const MAKE_WEBHOOK_URL = Deno.env.get('MAKE_INSTAGRAM_WEBHOOK_URL') || 'https://hook.us1.make.com/qeep7aakhh9lc8n5xjrtfx9f7rfa5v3l';

    const {
      image_url,
      caption,
      prompt = '',
      reference_image_urls = [],
      scheduled_at = null,
      scheduled_for_local = null,
      timezone = null,
    } = await req.json();

    if (!image_url) {
      return Response.json({ error: 'image_url é obrigatório' }, { status: 400 });
    }

    if (!caption?.trim()) {
      return Response.json({ error: 'caption é obrigatório' }, { status: 400 });
    }

    // Se a imagem já é uma URL pública do Base44, usa direto.
    // Caso contrário tenta re-upload para garantir URL pública (sem derrubar a função em caso de erro)
    let publicImageUrl = image_url;
    const isAlreadyPublic = typeof image_url === 'string' && image_url.includes('/files/mp/public/');
    if (!isAlreadyPublic) {
      try {
        const imgResponse = await fetch(image_url);
        if (imgResponse.ok) {
          const imgBlob = await imgResponse.blob();
          const contentType = imgResponse.headers.get('content-type') || 'image/png';
          const ext = contentType.includes('jpeg') ? 'jpg' : contentType.split('/')[1] || 'png';
          const file = new File([imgBlob], `campaign-${Date.now()}.${ext}`, { type: contentType });
          const uploadRes = await base44.integrations.Core.UploadFile({ file });
          if (uploadRes?.file_url) {
            publicImageUrl = uploadRes.file_url;
          }
        }
      } catch (uploadError) {
        console.error('Erro ao gerar URL pública, usando original:', uploadError?.message || uploadError);
      }
    }

    const payload = {
      // Campos no nível raiz (formato esperado pelo Make)
      image_url: publicImageUrl,
      caption,
      prompt,
      reference_image_urls,
      // Agendamento (opcional)
      scheduled_at,
      scheduled_for_local,
      timezone,
      is_scheduled: !!scheduled_at,
      // Metadados
      source: 'base44',
      platform: 'instagram',
      sent_by: user.email,
      created_at: new Date().toISOString(),
      // Mantém estrutura antiga para retrocompatibilidade
      campaign: {
        prompt,
        image_url: publicImageUrl,
        caption,
        reference_image_urls,
        scheduled_at,
        scheduled_for_local,
        timezone,
      },
    };

    const makeResponse = await fetch(MAKE_WEBHOOK_URL, {
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
      return Response.json(
        {
          error: 'Webhook do Make retornou erro',
          details: responseData,
        },
        { status: 502 },
      );
    }

    return Response.json({
      success: true,
      make_response: responseData,
    });
  } catch (error) {
    console.error('Error in sendCampaignToMake:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});