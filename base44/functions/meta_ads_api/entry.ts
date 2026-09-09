import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

function formatMetaError(data) {
    const e = data?.error;
    if (!e) return 'Meta API error';
    const parts = [e.error_user_title, e.error_user_msg, e.message].filter(Boolean);
    const base = parts.join(' — ') || 'Meta API error';
    const codes = [];
    if (e.code) codes.push(`code:${e.code}`);
    if (e.error_subcode) codes.push(`subcode:${e.error_subcode}`);
    if (e.fbtrace_id) codes.push(`trace:${e.fbtrace_id}`);
    return codes.length ? `${base} [${codes.join(' ')}]` : base;
}

async function metaFetch(path, params = {}) {
    const token = Deno.env.get('META_ACCESS_TOKEN');
    const url = new URL(`${META_BASE_URL}${path}`);
    url.searchParams.set('access_token', token);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok || data.error) {
        throw new Error(formatMetaError(data) || `Meta API error: ${res.status}`);
    }
    return data;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const { action, params = {} } = await req.json();
        const rawAccountId = params.ad_account_id || Deno.env.get('META_AD_ACCOUNT_ID') || '';
        const adAccountId = rawAccountId.startsWith('act_') ? rawAccountId : `act_${rawAccountId}`;

        switch (action) {
            case 'diagnose': {
                // Diagnóstico: lista contas que o token vê + businesses + permissões
                const me = await metaFetch('/me', { fields: 'id,name' });
                const accounts = await metaFetch('/me/adaccounts', {
                    fields: 'id,account_id,name,account_status,currency,business',
                    limit: 50
                });
                const businesses = await metaFetch('/me/businesses', {
                    fields: 'id,name',
                    limit: 50
                }).catch(e => ({ data: [], error: e.message }));
                return Response.json({
                    success: true,
                    configured_ad_account_id: adAccountId,
                    user: me,
                    accessible_ad_accounts: accounts.data,
                    businesses: businesses.data || businesses
                });
            }

            case 'test_connection': {
                const me = await metaFetch('/me', { fields: 'id,name' });
                const account = await metaFetch(`/${adAccountId}`, {
                    fields: 'id,name,account_status,currency,timezone_name,amount_spent,balance'
                });
                return Response.json({ success: true, user: me, account });
            }

            case 'list_campaigns': {
                const data = await metaFetch(`/${adAccountId}/campaigns`, {
                    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time',
                    limit: params.limit || 50
                });
                return Response.json({ success: true, campaigns: data.data });
            }

            case 'campaign_insights': {
                const datePreset = params.date_preset || 'last_30d';
                const data = await metaFetch(`/${adAccountId}/insights`, {
                    level: 'campaign',
                    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type',
                    date_preset: datePreset,
                    limit: params.limit || 100
                });
                return Response.json({ success: true, insights: data.data });
            }

            case 'account_insights': {
                const datePreset = params.date_preset || 'last_30d';
                const data = await metaFetch(`/${adAccountId}/insights`, {
                    fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions',
                    date_preset: datePreset
                });
                return Response.json({ success: true, insights: data.data });
            }

            case 'list_adsets': {
                const path = params.campaign_id ? `/${params.campaign_id}/adsets` : `/${adAccountId}/adsets`;
                const data = await metaFetch(path, {
                    fields: 'id,name,status,campaign_id,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting',
                    limit: params.limit || 50
                });
                return Response.json({ success: true, adsets: data.data });
            }

            case 'list_ads': {
                const path = params.adset_id ? `/${params.adset_id}/ads` : `/${adAccountId}/ads`;
                const data = await metaFetch(path, {
                    fields: 'id,name,status,adset_id,campaign_id,creative',
                    limit: params.limit || 50
                });
                return Response.json({ success: true, ads: data.data });
            }

            case 'list_pages': {
                // Lista páginas que o token tem acesso. Tenta múltiplas rotas porque System User
                // não vê páginas via /me/accounts — precisa buscar via Businesses (client_pages e owned_pages)
                const pagesMap = new Map();
                const errors = [];

                // 1. /me/accounts (usuário pessoal)
                try {
                    const r = await metaFetch('/me/accounts', { fields: 'id,name,instagram_business_account', limit: 100 });
                    (r.data || []).forEach(p => pagesMap.set(p.id, p));
                } catch (e) { errors.push('me/accounts: ' + e.message); }

                // 2. Páginas atribuídas à conta de anúncios (mais confiável para System User)
                try {
                    const r = await metaFetch(`/${adAccountId}/assigned_users`, { fields: 'id,name', limit: 50 });
                    // não retorna páginas, só usuários — pulamos
                } catch (e) { /* ignore */ }

                // 3. Descobrir Businesses: via /me/businesses + via Business da própria conta de anúncios
                const businessIds = new Set();
                try {
                    const biz = await metaFetch('/me/businesses', { fields: 'id,name', limit: 50 });
                    (biz.data || []).forEach(b => businessIds.add(b.id));
                } catch (e) { errors.push('me/businesses: ' + e.message); }

                try {
                    const acc = await metaFetch(`/${adAccountId}`, { fields: 'business' });
                    if (acc.business?.id) businessIds.add(acc.business.id);
                } catch (e) { errors.push('account business: ' + e.message); }

                // 4. Para cada Business: buscar owned_pages + client_pages
                for (const bizId of businessIds) {
                    try {
                        const owned = await metaFetch(`/${bizId}/owned_pages`, { fields: 'id,name,instagram_business_account', limit: 100 });
                        (owned.data || []).forEach(p => pagesMap.set(p.id, p));
                    } catch (e) { errors.push(`owned_pages ${bizId}: ` + e.message); }
                    try {
                        const client = await metaFetch(`/${bizId}/client_pages`, { fields: 'id,name,instagram_business_account', limit: 100 });
                        (client.data || []).forEach(p => pagesMap.set(p.id, p));
                    } catch (e) { errors.push(`client_pages ${bizId}: ` + e.message); }
                }

                return Response.json({ success: true, pages: Array.from(pagesMap.values()), debug_errors: errors });
            }

            case 'upload_image_from_url': {
                // Faz upload de imagem para a biblioteca de anúncios a partir de uma URL
                const { image_url } = params;
                if (!image_url) return Response.json({ error: 'image_url required' }, { status: 400 });
                
                // Baixar imagem
                const imgRes = await fetch(image_url);
                if (!imgRes.ok) throw new Error('Falha ao baixar imagem da URL');
                const imgBlob = await imgRes.blob();
                
                // Upload pra Meta
                const form = new FormData();
                form.append('access_token', Deno.env.get('META_ACCESS_TOKEN'));
                form.append('source', imgBlob, 'campaign.jpg');
                
                const res = await fetch(`${META_BASE_URL}/${adAccountId}/adimages`, { method: 'POST', body: form });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error?.message || 'Falha no upload da imagem');
                
                // A resposta vem como { images: { 'campaign.jpg': { hash, url } } }
                const imageInfo = Object.values(data.images || {})[0];
                return Response.json({ success: true, image_hash: imageInfo?.hash, image_url: imageInfo?.url });
            }

            case 'upload_video_from_url': {
                // Faz upload de vídeo
                const { video_url } = params;
                if (!video_url) return Response.json({ error: 'video_url required' }, { status: 400 });
                
                const videoRes = await fetch(video_url);
                if (!videoRes.ok) throw new Error('Falha ao baixar vídeo da URL');
                const videoBlob = await videoRes.blob();
                
                const form = new FormData();
                form.append('access_token', Deno.env.get('META_ACCESS_TOKEN'));
                form.append('source', videoBlob, 'campaign.mp4');
                
                const res = await fetch(`${META_BASE_URL}/${adAccountId}/advideos`, { method: 'POST', body: form });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error?.message || 'Falha no upload do vídeo');
                
                return Response.json({ success: true, video_id: data.id });
            }

            case 'publish_complete_campaign': {
                // Cria CAMPANHA + ADSET + CRIATIVO + ANÚNCIO e ATIVA tudo
                const {
                    name, objective, daily_budget,
                    page_id, image_hash, video_id,
                    headline, primary_text, description,
                    link_url, cta_type = 'LEARN_MORE',
                    age_min = 18, age_max = 65,
                    countries = ['BR'],
                    activate = true
                } = params;

                if (!name || !objective || !daily_budget || !page_id) {
                    return Response.json({ error: 'name, objective, daily_budget, page_id são obrigatórios' }, { status: 400 });
                }
                if (!image_hash && !video_id) {
                    return Response.json({ error: 'image_hash ou video_id necessário' }, { status: 400 });
                }
                if (!primary_text) {
                    return Response.json({ error: 'primary_text (copy) é obrigatório' }, { status: 400 });
                }

                const token = Deno.env.get('META_ACCESS_TOKEN');
                const finalStatus = activate ? 'ACTIVE' : 'PAUSED';

                // Mapeamento de objetivo → optimization_goal e billing_event do adset
                const objectiveMap = {
                    OUTCOME_AWARENESS: { optimization_goal: 'REACH', billing_event: 'IMPRESSIONS' },
                    OUTCOME_TRAFFIC: { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS' },
                    OUTCOME_ENGAGEMENT: { optimization_goal: 'POST_ENGAGEMENT', billing_event: 'IMPRESSIONS' },
                    OUTCOME_LEADS: { optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS' },
                    OUTCOME_SALES: { optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
                };
                const goalCfg = objectiveMap[objective] || objectiveMap.OUTCOME_TRAFFIC;

                // 1. CAMPANHA
                const campBody = new URLSearchParams();
                campBody.set('access_token', token);
                campBody.set('name', name);
                campBody.set('objective', objective);
                campBody.set('status', finalStatus);
                campBody.set('special_ad_categories', '[]');
                campBody.set('is_adset_budget_sharing_enabled', 'false');
                const campRes = await fetch(`${META_BASE_URL}/${adAccountId}/campaigns`, { method: 'POST', body: campBody });
                const campData = await campRes.json();
                if (!campRes.ok || campData.error) throw new Error('Campanha: ' + formatMetaError(campData));
                const campaignId = campData.id;

                // 2. ADSET
                const startTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();
                const targeting = {
                    geo_locations: { countries },
                    age_min, age_max,
                    publisher_platforms: ['facebook', 'instagram'],
                    facebook_positions: ['feed', 'story'],
                    instagram_positions: ['stream', 'story', 'reels'],
                    targeting_automation: { advantage_audience: 0 },
                };
                const adsetBody = new URLSearchParams();
                adsetBody.set('access_token', token);
                adsetBody.set('name', `${name} - Conjunto`);
                adsetBody.set('campaign_id', campaignId);
                adsetBody.set('daily_budget', String(daily_budget));
                adsetBody.set('billing_event', goalCfg.billing_event);
                adsetBody.set('optimization_goal', goalCfg.optimization_goal);
                adsetBody.set('bid_strategy', 'LOWEST_COST_WITHOUT_CAP');
                adsetBody.set('targeting', JSON.stringify(targeting));
                adsetBody.set('start_time', startTime);
                adsetBody.set('status', finalStatus);

                // promoted_object: a Meta exige indicar o que está sendo promovido (Página, URL, app, etc).
                // Para a maioria dos objetivos com tráfego para página/site, page_id resolve.
                // OUTCOME_SALES/LEADS normalmente usam pixel - aqui mantemos page_id como padrão seguro.
                if (page_id) {
                    adsetBody.set('promoted_object', JSON.stringify({ page_id }));
                }
                const adsetRes = await fetch(`${META_BASE_URL}/${adAccountId}/adsets`, { method: 'POST', body: adsetBody });
                const adsetData = await adsetRes.json();
                if (!adsetRes.ok || adsetData.error) {
                    await fetch(`${META_BASE_URL}/${campaignId}?access_token=${token}`, { method: 'DELETE' });
                    throw new Error('Conjunto: ' + formatMetaError(adsetData));
                }
                const adsetId = adsetData.id;

                // 3. CRIATIVO
                const linkData = {
                    message: primary_text,
                    link: link_url || 'https://www.5asec.com.br',
                    call_to_action: { type: cta_type, value: { link: link_url || 'https://www.5asec.com.br' } },
                };
                if (headline) linkData.name = headline;
                if (description) linkData.description = description;
                if (image_hash) linkData.image_hash = image_hash;
                if (video_id) linkData.video_id = video_id;

                const creativeBody = new URLSearchParams();
                creativeBody.set('access_token', token);
                creativeBody.set('name', `${name} - Criativo`);
                creativeBody.set('object_story_spec', JSON.stringify({
                    page_id,
                    link_data: linkData,
                }));
                const creativeRes = await fetch(`${META_BASE_URL}/${adAccountId}/adcreatives`, { method: 'POST', body: creativeBody });
                const creativeData = await creativeRes.json();
                if (!creativeRes.ok || creativeData.error) {
                    await fetch(`${META_BASE_URL}/${campaignId}?access_token=${token}`, { method: 'DELETE' });
                    throw new Error('Criativo: ' + formatMetaError(creativeData));
                }
                const creativeId = creativeData.id;

                // 4. AD
                const adBody = new URLSearchParams();
                adBody.set('access_token', token);
                adBody.set('name', `${name} - Anúncio`);
                adBody.set('adset_id', adsetId);
                adBody.set('creative', JSON.stringify({ creative_id: creativeId }));
                adBody.set('status', finalStatus);
                const adRes = await fetch(`${META_BASE_URL}/${adAccountId}/ads`, { method: 'POST', body: adBody });
                const adData = await adRes.json();
                if (!adRes.ok || adData.error) {
                    await fetch(`${META_BASE_URL}/${campaignId}?access_token=${token}`, { method: 'DELETE' });
                    throw new Error('Anúncio: ' + formatMetaError(adData));
                }

                return Response.json({
                    success: true,
                    campaign_id: campaignId,
                    adset_id: adsetId,
                    creative_id: creativeId,
                    ad_id: adData.id,
                    status: finalStatus,
                });
            }

            case 'create_campaign': {
                // Cria uma campanha (não publica anúncios — fica em PAUSED até ativar)
                const { name, objective, daily_budget, status = 'PAUSED', special_ad_categories = [] } = params;
                if (!name || !objective) {
                    return Response.json({ error: 'name and objective are required' }, { status: 400 });
                }
                const url = new URL(`${META_BASE_URL}/${adAccountId}/campaigns`);
                const body = new URLSearchParams();
                body.set('access_token', Deno.env.get('META_ACCESS_TOKEN'));
                body.set('name', name);
                body.set('objective', objective);
                body.set('status', status);
                body.set('special_ad_categories', JSON.stringify(special_ad_categories));
                body.set('is_adset_budget_sharing_enabled', 'false');
                if (daily_budget) body.set('daily_budget', String(daily_budget)); // em centavos
                const res = await fetch(url.toString(), { method: 'POST', body });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(formatMetaError(data) || 'Failed to create campaign');
                return Response.json({ success: true, campaign: data });
            }

            case 'pause_campaign':
            case 'activate_campaign': {
                if (!params.campaign_id) return Response.json({ error: 'campaign_id required' }, { status: 400 });
                const status = action === 'pause_campaign' ? 'PAUSED' : 'ACTIVE';
                const url = new URL(`${META_BASE_URL}/${params.campaign_id}`);
                url.searchParams.set('access_token', Deno.env.get('META_ACCESS_TOKEN'));
                url.searchParams.set('status', status);
                const res = await fetch(url.toString(), { method: 'POST' });
                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error?.message || 'Failed');
                return Response.json({ success: true, status });
            }

            default:
                return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }
    } catch (error) {
        console.error('meta_ads_api error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});