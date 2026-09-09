import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// Publica uma imagem com legenda na Página do Facebook.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const imageUrl = body.image_url;
    const caption = body.caption || '';
    if (!imageUrl) return Response.json({ error: 'image_url é obrigatório' }, { status: 400 });

    const accessToken = Deno.env.get('FACEBOOK_PAGE_ACCESS_TOKEN');
    const pageId = Deno.env.get('MESSENGER_PAGE_ID');
    if (!accessToken || !pageId) {
      return Response.json({ error: 'Integração do Facebook não configurada' }, { status: 503 });
    }

    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: imageUrl, caption, access_token: accessToken }),
    });
    const data = await res.json();
    if (!res.ok || !(data.post_id || data.id)) {
      console.error('Facebook publish failed:', JSON.stringify(data));
      return Response.json({ error: data?.error?.message || 'facebook_publish_failed' }, { status: 502 });
    }

    return Response.json({ status: 'published', post_id: data.post_id || data.id });
  } catch (error) {
    console.error('facebookPublish error:', error?.message || error);
    return Response.json({ error: error?.message || 'failed' }, { status: 500 });
  }
}