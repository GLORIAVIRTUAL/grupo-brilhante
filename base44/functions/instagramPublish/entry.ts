import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Publica uma imagem com legenda no feed do Instagram Business.
// Fluxo oficial: cria o container de mídia e depois publica.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const imageUrl = body.image_url;
    const caption = body.caption || '';
    if (!imageUrl) return Response.json({ error: 'image_url é obrigatório' }, { status: 400 });

    const accessToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN');
    if (!accessToken) {
      return Response.json({ error: 'Integração do Instagram não configurada' }, { status: 503 });
    }
    // 'me' resolve a conta do próprio token (Instagram Login API).
    const accountId = 'me';

    const createRes = await fetch(`https://graph.instagram.com/v21.0/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
    });
    const created = await createRes.json();
    if (!createRes.ok || !created.id) {
      console.error('Instagram media container failed:', JSON.stringify(created));
      return Response.json({ error: 'instagram_container_failed', details: created }, { status: 502 });
    }

    // A Meta processa a mídia de forma assíncrona; aguardamos alguns ciclos.
    let publishData = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const publishRes = await fetch(`https://graph.instagram.com/v21.0/${accountId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: created.id, access_token: accessToken }),
      });
      publishData = await publishRes.json();
      if (publishRes.ok && publishData.id) {
        return Response.json({ status: 'published', media_id: publishData.id, container_id: created.id });
      }
    }

    console.error('Instagram publish failed:', JSON.stringify(publishData));
    return Response.json({ error: 'instagram_publish_failed', details: publishData }, { status: 502 });
  } catch (error) {
    console.error('instagramPublish error:', error?.message || error);
    return Response.json({ error: error?.message || 'failed' }, { status: 500 });
  }
}