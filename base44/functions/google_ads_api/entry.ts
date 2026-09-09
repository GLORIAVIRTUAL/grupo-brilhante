import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const GOOGLE_ADS_API_VERSION = 'v21';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_API_BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;

// =========== OAuth Helpers ===========
async function getAccessToken() {
  const clientId = (Deno.env.get('GOOGLE_ADS_CLIENT_ID') || '').trim();
  const clientSecret = (Deno.env.get('GOOGLE_ADS_CLIENT_SECRET') || '').trim();
  const refreshToken = (Deno.env.get('GOOGLE_ADS_REFRESH_TOKEN') || '').trim();

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Credenciais OAuth do Google Ads não configuradas. Faltam: CLIENT_ID, CLIENT_SECRET ou REFRESH_TOKEN.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Falha ao obter access token Google: ${errText}`);
  }
  const data = await res.json();
  return data.access_token;
}

function cleanId(raw) {
  return (raw || '').trim().replace(/[-\s]/g, '');
}

function getHeaders(accessToken, options = {}) {
  const devToken = (Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim();
  const loginCustomerId = cleanId(Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));

  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': devToken,
    'Content-Type': 'application/json',
  };
  // Só inclui login-customer-id se não foi explicitamente desativado
  if (loginCustomerId && !options.skipLoginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }
  return headers;
}

function getCustomerId() {
  const id = cleanId(Deno.env.get('GOOGLE_ADS_CUSTOMER_ID'));
  if (!id) throw new Error('GOOGLE_ADS_CUSTOMER_ID não configurado.');
  return id;
}

// Verifica se uma conta é manager (MCC). Retorna true/false.
// Cache em memória para evitar chamadas extras.
const managerCache = new Map();
async function isManagerAccount(customerId, accessToken) {
  if (managerCache.has(customerId)) return managerCache.get(customerId);
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken),
    body: JSON.stringify({ query: 'SELECT customer.manager FROM customer LIMIT 1' }),
  });
  if (!res.ok) {
    managerCache.set(customerId, false);
    return false;
  }
  const json = await res.json();
  let isManager = false;
  const batches = Array.isArray(json) ? json : [json];
  for (const b of batches) {
    for (const r of (b.results || [])) {
      if (r.customer?.manager === true) isManager = true;
    }
  }
  managerCache.set(customerId, isManager);
  return isManager;
}

// Resolve a conta cliente correta para operações de métricas/campanhas.
// Retorna { id, skipLoginCustomerId } — skipLoginCustomerId=true se a conta acessível diretamente via OAuth (não-filha do MCC).
let resolvedClientCache = null;
async function resolveClientCustomerId() {
  if (resolvedClientCache) return resolvedClientCache;
  const configuredId = getCustomerId();
  const loginCustomerId = cleanId(Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
  const accessToken = await getAccessToken();
  const isManager = await isManagerAccount(configuredId, accessToken);
  if (!isManager) {
    resolvedClientCache = { id: configuredId, skipLoginCustomerId: false };
    return resolvedClientCache;
  }
  // É manager — buscar contas acessíveis e testar cada uma
  const url = `${ADS_API_BASE}/customers:listAccessibleCustomers`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'developer-token': (Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim() },
  });
  if (!res.ok) {
    resolvedClientCache = { id: configuredId, skipLoginCustomerId: false };
    return resolvedClientCache;
  }
  const data = await res.json();
  const accessible = (data.resourceNames || []).map(r => r.split('/').pop());

  // Testar cada conta acessível com e sem login-customer-id pra achar uma que funciona
  for (const candidate of accessible) {
    if (candidate === configuredId) continue;
    // Tenta com login-customer-id (conta filha do MCC)
    const testUrl = `${ADS_API_BASE}/customers/${candidate}/googleAds:searchStream`;
    const testQuery = { query: 'SELECT customer.id, customer.manager FROM customer LIMIT 1' };
    const withMcc = await fetch(testUrl, { method: 'POST', headers: getHeaders(accessToken), body: JSON.stringify(testQuery) });
    if (withMcc.ok) {
      const json = await withMcc.json();
      const batches = Array.isArray(json) ? json : [json];
      let isMgr = false;
      for (const b of batches) for (const r of (b.results || [])) if (r.customer?.manager === true) isMgr = true;
      if (!isMgr) {
        resolvedClientCache = { id: candidate, skipLoginCustomerId: false };
        return resolvedClientCache;
      }
    }
    // Tenta SEM login-customer-id (conta direta do OAuth)
    const withoutMcc = await fetch(testUrl, {
      method: 'POST',
      headers: getHeaders(accessToken, { skipLoginCustomerId: true }),
      body: JSON.stringify(testQuery),
    });
    if (withoutMcc.ok) {
      const json = await withoutMcc.json();
      const batches = Array.isArray(json) ? json : [json];
      let isMgr = false;
      for (const b of batches) for (const r of (b.results || [])) if (r.customer?.manager === true) isMgr = true;
      if (!isMgr) {
        resolvedClientCache = { id: candidate, skipLoginCustomerId: true };
        return resolvedClientCache;
      }
    }
  }
  resolvedClientCache = { id: configuredId, skipLoginCustomerId: false };
  return resolvedClientCache;
}

// Garante que a URL final tenha protocolo (Google Ads exige http:// ou https://)
function normalizeUrl(url) {
  if (!url) return url;
  const u = String(url).trim();
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

// =========== API helpers ===========
async function adsSearch(query) {
  const accessToken = await getAccessToken();
  const client = await resolveClientCustomerId();
  const url = `${ADS_API_BASE}/customers/${client.id}/googleAds:searchStream`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    // truncar HTML pra exibir mensagem legível
    const snippet = text.length > 500 ? text.substring(0, 500) + '...' : text;
    throw new Error(`Google Ads search erro (HTTP ${res.status}): ${snippet}`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Google Ads retornou resposta inv\u00e1lida (n\u00e3o-JSON). Possivelmente o Developer Token n\u00e3o est\u00e1 aprovado ou a API n\u00e3o est\u00e1 ativada. Trecho: ${text.substring(0, 300)}`); }
  // searchStream retorna array de batches
  const rows = [];
  if (Array.isArray(json)) {
    for (const batch of json) {
      if (batch.results) rows.push(...batch.results);
    }
  } else if (json.results) {
    rows.push(...json.results);
  }
  return rows;
}

async function adsMutate(endpoint, body) {
  const accessToken = await getAccessToken();
  const client = await resolveClientCustomerId();
  const url = `${ADS_API_BASE}/customers/${client.id}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Google Ads mutate erro (${endpoint}): ${text}`);
  return JSON.parse(text);
}

// =========== Actions ===========

// Diagnóstico: testa as credenciais e lista contas acessíveis
async function diagnose() {
  const accessToken = await getAccessToken();
  const devToken = (Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim();
  const customerId = getCustomerId();
  const loginCustomerId = cleanId(Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));

  const url = `${ADS_API_BASE}/customers:listAccessibleCustomers`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': devToken,
      'Content-Type': 'application/json',
    },
  });
  const rawText = await res.text();
  console.log('[diagnose] URL:', url);
  console.log('[diagnose] HTTP status:', res.status);
  console.log('[diagnose] First 200 chars:', rawText.substring(0, 200));
  let data;
  let parseError = null;
  try { data = JSON.parse(rawText); }
  catch (e) {
    parseError = `Resposta n\u00e3o-JSON (HTTP ${res.status}). Trecho: ${rawText.substring(0, 400)}`;
    data = { _raw: rawText.substring(0, 1000) };
  }

  // Resolver a conta cliente real (usada para métricas/campanhas)
  let resolved = null;
  let isManager = false;
  try {
    isManager = await isManagerAccount(customerId, accessToken);
    resolved = await resolveClientCustomerId();
  } catch (e) {
    console.error('Erro ao resolver conta cliente:', e.message);
  }

  return {
    success: res.ok && !parseError,
    http_status: res.status,
    parse_error: parseError,
    has_developer_token: !!devToken,
    has_access_token: !!accessToken,
    customer_id: customerId,
    customer_id_is_manager: isManager,
    resolved_client_id: resolved?.id || null,
    resolved_client_uses_mcc: resolved ? !resolved.skipLoginCustomerId : null,
    login_customer_id: loginCustomerId,
    accessible_customers: data.resourceNames || [],
    raw: data,
  };
}

// Listar campanhas
async function listCampaigns() {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.start_date,
      campaign.end_date,
      campaign_budget.amount_micros
    FROM campaign
    ORDER BY campaign.id DESC
    LIMIT 100
  `;
  const rows = await adsSearch(query);
  return rows.map(r => ({
    id: r.campaign?.id,
    name: r.campaign?.name,
    status: r.campaign?.status,
    channel_type: r.campaign?.advertisingChannelType,
    start_date: r.campaign?.startDate,
    end_date: r.campaign?.endDate,
    budget_brl: r.campaignBudget?.amountMicros ? Number(r.campaignBudget.amountMicros) / 1_000_000 : 0,
  }));
}

// Métricas das campanhas
async function getMetrics({ date_range = 'LAST_30_DAYS' } = {}) {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM campaign
    WHERE segments.date DURING ${date_range}
    ORDER BY metrics.cost_micros DESC
  `;
  const rows = await adsSearch(query);
  return rows.map(r => ({
    campaign_id: r.campaign?.id,
    campaign_name: r.campaign?.name,
    status: r.campaign?.status,
    impressions: Number(r.metrics?.impressions || 0),
    clicks: Number(r.metrics?.clicks || 0),
    ctr: Number(r.metrics?.ctr || 0),
    avg_cpc_brl: r.metrics?.averageCpc ? Number(r.metrics.averageCpc) / 1_000_000 : 0,
    cost_brl: r.metrics?.costMicros ? Number(r.metrics.costMicros) / 1_000_000 : 0,
    conversions: Number(r.metrics?.conversions || 0),
    conversions_value: Number(r.metrics?.conversionsValue || 0),
  }));
}

// Pausar / Ativar campanha
async function setCampaignStatus({ campaign_id, status }) {
  if (!campaign_id || !status) throw new Error('campaign_id e status são obrigatórios.');
  const client = await resolveClientCustomerId();
  const resourceName = `customers/${client.id}/campaigns/${campaign_id}`;
  const body = {
    operations: [{
      update: { resourceName, status },
      updateMask: 'status',
    }],
  };
  return await adsMutate('campaigns:mutate', body);
}

// Criar campanha de Pesquisa (Search) completa: budget + campaign + ad group + keywords + RSA
async function createSearchCampaign(params) {
  let {
    name,
    daily_budget_brl,
    location_ids = [], // ex: [2076] = Brasil; cidades têm IDs específicos
    keywords = [],
    headlines = [],
    descriptions = [],
    final_url,
    start_paused = true,
  } = params;

  if (!name) throw new Error('name é obrigatório');
  if (!daily_budget_brl || daily_budget_brl < 1) throw new Error('daily_budget_brl mínimo é R$ 1');
  if (!final_url) throw new Error('final_url (URL de destino) é obrigatório');
  final_url = normalizeUrl(final_url);
  if (headlines.length < 3) throw new Error('Mínimo de 3 headlines');
  if (descriptions.length < 2) throw new Error('Mínimo de 2 descriptions');
  if (keywords.length < 1) throw new Error('Mínimo de 1 palavra-chave');

  const client = await resolveClientCustomerId();
  const customerId = client.id;
  const budgetMicros = Math.round(Number(daily_budget_brl) * 1_000_000);

  // Temp resource names (negativos)
  const budgetTempId = -1;
  const campaignTempId = -2;
  const adGroupTempId = -3;

  const budgetResource = `customers/${customerId}/campaignBudgets/${budgetTempId}`;
  const campaignResource = `customers/${customerId}/campaigns/${campaignTempId}`;
  const adGroupResource = `customers/${customerId}/adGroups/${adGroupTempId}`;

  // Usamos googleAds:mutate para fazer tudo em uma única transação
  const operations = [];

  // 1) Budget
  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetResource,
        name: `${name} - Budget ${Date.now()}`,
        amountMicros: String(budgetMicros),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  });

  // 2) Campaign
  operations.push({
    campaignOperation: {
      create: {
        resourceName: campaignResource,
        name,
        status: start_paused ? 'PAUSED' : 'ENABLED',
        advertisingChannelType: 'SEARCH',
        manualCpc: { enhancedCpcEnabled: false },
        campaignBudget: budgetResource,
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: true,
          targetContentNetwork: false,
          targetPartnerSearchNetwork: false,
        },
      },
    },
  });

  // 3) Locations targeting (geo)
  for (const locId of location_ids) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${locId}` },
        },
      },
    });
  }

  // 4) Ad Group
  operations.push({
    adGroupOperation: {
      create: {
        resourceName: adGroupResource,
        campaign: campaignResource,
        name: `${name} - Grupo Principal`,
        status: 'ENABLED',
        type: 'SEARCH_STANDARD',
        cpcBidMicros: String(Math.round(budgetMicros / 10)), // lance padrão = 10% do budget
      },
    },
  });

  // 5) Keywords (broad match)
  for (const kw of keywords) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          status: 'ENABLED',
          keyword: { text: kw, matchType: 'BROAD' },
        },
      },
    });
  }

  // 6) Responsive Search Ad
  operations.push({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupResource,
        status: 'ENABLED',
        ad: {
          finalUrls: [final_url],
          responsiveSearchAd: {
            headlines: headlines.slice(0, 15).map(t => ({ text: String(t).slice(0, 30) })),
            descriptions: descriptions.slice(0, 4).map(t => ({ text: String(t).slice(0, 90) })),
          },
        },
      },
    },
  });

  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ao criar campanha Google Ads: ${text}`);
  const json = JSON.parse(text);

  // extrai o ID da campanha criada
  let createdCampaignId = null;
  for (const r of (json.mutateOperationResponses || [])) {
    if (r.campaignResult?.resourceName) {
      createdCampaignId = r.campaignResult.resourceName.split('/').pop();
      break;
    }
  }

  return {
    success: true,
    campaign_id: createdCampaignId,
    campaign_resource: createdCampaignId ? `customers/${customerId}/campaigns/${createdCampaignId}` : null,
    raw: json,
  };
}

// Criar campanha de DISPLAY (com imagens - Responsive Display Ad)
async function createDisplayCampaign(params) {
  let {
    name,
    daily_budget_brl,
    location_ids = [],
    headlines = [],
    long_headline,
    descriptions = [],
    business_name = '5àsec',
    marketing_image_urls = [], // 1.91:1 (1200x628 recomendado)
    square_image_urls = [],    // 1:1 (1200x1200 recomendado)
    logo_image_urls = [],      // 1:1 logo
    final_url,
    start_paused = true,
  } = params;

  if (!name) throw new Error('name é obrigatório');
  if (!daily_budget_brl || daily_budget_brl < 1) throw new Error('daily_budget_brl mínimo é R$ 1');
  if (!final_url) throw new Error('final_url é obrigatório');
  final_url = normalizeUrl(final_url);
  if (headlines.length < 1) throw new Error('Mínimo de 1 headline curto');
  if (!long_headline) throw new Error('long_headline é obrigatório (até 90 caracteres)');
  if (descriptions.length < 1) throw new Error('Mínimo de 1 description');
  if (marketing_image_urls.length < 1) throw new Error('Mínimo de 1 imagem retangular (1.91:1)');
  if (square_image_urls.length < 1) throw new Error('Mínimo de 1 imagem quadrada (1:1)');

  const client = await resolveClientCustomerId();
  const customerId = client.id;
  const budgetMicros = Math.round(Number(daily_budget_brl) * 1_000_000);

  const budgetTempId = -1;
  const campaignTempId = -2;
  const adGroupTempId = -3;
  const budgetResource = `customers/${customerId}/campaignBudgets/${budgetTempId}`;
  const campaignResource = `customers/${customerId}/campaigns/${campaignTempId}`;
  const adGroupResource = `customers/${customerId}/adGroups/${adGroupTempId}`;

  // Upload de imagens via assets (precisamos criar Asset Image antes)
  const uploadedAssets = await uploadImageAssets([
    ...marketing_image_urls.map(u => ({ url: u, name: 'marketing' })),
    ...square_image_urls.map(u => ({ url: u, name: 'square' })),
    ...logo_image_urls.map(u => ({ url: u, name: 'logo' })),
  ]);

  const marketingAssets = uploadedAssets.slice(0, marketing_image_urls.length);
  const squareAssets = uploadedAssets.slice(marketing_image_urls.length, marketing_image_urls.length + square_image_urls.length);
  const logoAssets = uploadedAssets.slice(marketing_image_urls.length + square_image_urls.length);

  const operations = [];

  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetResource,
        name: `${name} - Budget ${Date.now()}`,
        amountMicros: String(budgetMicros),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  });

  operations.push({
    campaignOperation: {
      create: {
        resourceName: campaignResource,
        name,
        status: start_paused ? 'PAUSED' : 'ENABLED',
        advertisingChannelType: 'DISPLAY',
        manualCpc: { enhancedCpcEnabled: false },
        campaignBudget: budgetResource,
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      },
    },
  });

  for (const locId of location_ids) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${locId}` },
        },
      },
    });
  }

  operations.push({
    adGroupOperation: {
      create: {
        resourceName: adGroupResource,
        campaign: campaignResource,
        name: `${name} - Display Group`,
        status: 'ENABLED',
        type: 'DISPLAY_STANDARD',
        cpcBidMicros: String(Math.round(budgetMicros / 20)),
      },
    },
  });

  operations.push({
    adGroupAdOperation: {
      create: {
        adGroup: adGroupResource,
        status: 'ENABLED',
        ad: {
          finalUrls: [final_url],
          responsiveDisplayAd: {
            headlines: headlines.slice(0, 5).map(t => ({ text: String(t).slice(0, 30) })),
            longHeadline: { text: String(long_headline).slice(0, 90) },
            descriptions: descriptions.slice(0, 5).map(t => ({ text: String(t).slice(0, 90) })),
            businessName: business_name,
            marketingImages: marketingAssets.map(a => ({ asset: a })),
            squareMarketingImages: squareAssets.map(a => ({ asset: a })),
            logoImages: logoAssets.map(a => ({ asset: a })),
          },
        },
      },
    },
  });

  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ao criar campanha Display: ${text}`);
  const json = JSON.parse(text);

  let createdCampaignId = null;
  for (const r of (json.mutateOperationResponses || [])) {
    if (r.campaignResult?.resourceName) {
      createdCampaignId = r.campaignResult.resourceName.split('/').pop();
      break;
    }
  }
  return { success: true, campaign_id: createdCampaignId, raw: json };
}

// Upload de imagens como assets (necessário pra Display / PMax)
async function uploadImageAssets(images) {
  if (!images.length) return [];
  const client = await resolveClientCustomerId();
  const customerId = client.id;
  const accessToken = await getAccessToken();

  const operations = [];
  for (const img of images) {
    // Baixar a imagem
    const imgRes = await fetch(img.url);
    if (!imgRes.ok) throw new Error(`Falha ao baixar imagem ${img.url}`);
    const buf = new Uint8Array(await imgRes.arrayBuffer());
    // Converter para base64
    let binary = '';
    for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
    const base64 = btoa(binary);

    operations.push({
      create: {
        name: `${img.name}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        type: 'IMAGE',
        imageAsset: { data: base64 },
      },
    });
  }

  const url = `${ADS_API_BASE}/customers/${customerId}/assets:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ operations }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ao subir imagens: ${text}`);
  const json = JSON.parse(text);
  return (json.results || []).map(r => r.resourceName);
}

// Criar campanha PERFORMANCE MAX (multi-canal automatizada)
async function createPerformanceMaxCampaign(params) {
  let {
    name,
    daily_budget_brl,
    location_ids = [],
    headlines = [],
    long_headlines = [],
    descriptions = [],
    business_name = '5àsec',
    marketing_image_urls = [],
    square_image_urls = [],
    logo_image_urls = [],
    final_url,
    start_paused = true,
  } = params;

  if (!name) throw new Error('name é obrigatório');
  if (!final_url) throw new Error('final_url é obrigatório');
  final_url = normalizeUrl(final_url);
  if (headlines.length < 3) throw new Error('Mínimo de 3 headlines (até 30 chars)');
  if (long_headlines.length < 1) throw new Error('Mínimo de 1 long_headline (até 90 chars)');
  if (descriptions.length < 2) throw new Error('Mínimo de 2 descriptions');
  if (marketing_image_urls.length < 1) throw new Error('Mínimo de 1 imagem retangular');
  if (square_image_urls.length < 1) throw new Error('Mínimo de 1 imagem quadrada');
  if (logo_image_urls.length < 1) throw new Error('Mínimo de 1 logo');

  const client = await resolveClientCustomerId();
  const customerId = client.id;
  const budgetMicros = Math.round(Number(daily_budget_brl) * 1_000_000);

  const uploadedAssets = await uploadImageAssets([
    ...marketing_image_urls.map(u => ({ url: u, name: 'pmax_marketing' })),
    ...square_image_urls.map(u => ({ url: u, name: 'pmax_square' })),
    ...logo_image_urls.map(u => ({ url: u, name: 'pmax_logo' })),
  ]);

  const marketingAssets = uploadedAssets.slice(0, marketing_image_urls.length);
  const squareAssets = uploadedAssets.slice(marketing_image_urls.length, marketing_image_urls.length + square_image_urls.length);
  const logoAssets = uploadedAssets.slice(marketing_image_urls.length + square_image_urls.length);

  const budgetTempId = -1;
  const campaignTempId = -2;
  const assetGroupTempId = -3;
  const budgetResource = `customers/${customerId}/campaignBudgets/${budgetTempId}`;
  const campaignResource = `customers/${customerId}/campaigns/${campaignTempId}`;
  const assetGroupResource = `customers/${customerId}/assetGroups/${assetGroupTempId}`;

  const operations = [];

  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budgetResource,
        name: `${name} - Budget ${Date.now()}`,
        amountMicros: String(budgetMicros),
        deliveryMethod: 'STANDARD',
        explicitlyShared: false,
      },
    },
  });

  operations.push({
    campaignOperation: {
      create: {
        resourceName: campaignResource,
        name,
        status: start_paused ? 'PAUSED' : 'ENABLED',
        advertisingChannelType: 'PERFORMANCE_MAX',
        maximizeConversions: {},
        campaignBudget: budgetResource,
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      },
    },
  });

  for (const locId of location_ids) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${locId}` },
        },
      },
    });
  }

  // Asset Group (obrigatório em PMax)
  operations.push({
    assetGroupOperation: {
      create: {
        resourceName: assetGroupResource,
        campaign: campaignResource,
        name: `${name} - Asset Group`,
        finalUrls: [final_url],
        status: 'ENABLED',
      },
    },
  });

  // Texts como assets
  for (const h of headlines.slice(0, 5)) {
    operations.push({
      assetOperation: {
        create: { name: `h_${Date.now()}_${Math.random()}`, textAsset: { text: String(h).slice(0, 30) } },
      },
    });
  }

  // Atalho: vinculamos imagens já existentes a o asset group
  const assetGroupAssetOps = [];
  for (const asset of marketingAssets) {
    assetGroupAssetOps.push({
      assetGroupAssetOperation: {
        create: { assetGroup: assetGroupResource, asset, fieldType: 'MARKETING_IMAGE' },
      },
    });
  }
  for (const asset of squareAssets) {
    assetGroupAssetOps.push({
      assetGroupAssetOperation: {
        create: { assetGroup: assetGroupResource, asset, fieldType: 'SQUARE_MARKETING_IMAGE' },
      },
    });
  }
  for (const asset of logoAssets) {
    assetGroupAssetOps.push({
      assetGroupAssetOperation: {
        create: { assetGroup: assetGroupResource, asset, fieldType: 'LOGO' },
      },
    });
  }
  operations.push(...assetGroupAssetOps);

  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ao criar campanha PMax: ${text}`);
  const json = JSON.parse(text);

  let createdCampaignId = null;
  for (const r of (json.mutateOperationResponses || [])) {
    if (r.campaignResult?.resourceName) {
      createdCampaignId = r.campaignResult.resourceName.split('/').pop();
      break;
    }
  }
  return { success: true, campaign_id: createdCampaignId, raw: json };
}

// Criar campanha VÍDEO (YouTube)
async function createVideoCampaign(params) {
  let {
    name,
    daily_budget_brl,
    location_ids = [],
    youtube_video_id, // ex: "dQw4w9WgXcQ"
    final_url,
    start_paused = true,
  } = params;

  if (!name) throw new Error('name é obrigatório');
  if (!youtube_video_id) throw new Error('youtube_video_id é obrigatório (ID do vídeo no YouTube)');
  if (!final_url) throw new Error('final_url é obrigatório');
  final_url = normalizeUrl(final_url);

  const client = await resolveClientCustomerId();
  const customerId = client.id;
  const budgetMicros = Math.round(Number(daily_budget_brl) * 1_000_000);

  const budgetTempId = -1;
  const campaignTempId = -2;
  const adGroupTempId = -3;
  const budgetResource = `customers/${customerId}/campaignBudgets/${budgetTempId}`;
  const campaignResource = `customers/${customerId}/campaigns/${campaignTempId}`;
  const adGroupResource = `customers/${customerId}/adGroups/${adGroupTempId}`;

  const operations = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetResource,
          name: `${name} - Budget ${Date.now()}`,
          amountMicros: String(budgetMicros),
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignResource,
          name,
          status: start_paused ? 'PAUSED' : 'ENABLED',
          advertisingChannelType: 'VIDEO',
          campaignBudget: budgetResource,
          manualCpv: {},
          containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
        },
      },
    },
    ...location_ids.map(locId => ({
      campaignCriterionOperation: {
        create: {
          campaign: campaignResource,
          location: { geoTargetConstant: `geoTargetConstants/${locId}` },
        },
      },
    })),
    {
      adGroupOperation: {
        create: {
          resourceName: adGroupResource,
          campaign: campaignResource,
          name: `${name} - Video Group`,
          status: 'ENABLED',
          type: 'VIDEO_TRUE_VIEW_IN_STREAM',
        },
      },
    },
    {
      adGroupAdOperation: {
        create: {
          adGroup: adGroupResource,
          status: 'ENABLED',
          ad: {
            finalUrls: [final_url],
            videoResponsiveAd: {
              videos: [{ asset: `customers/${customerId}/assets/${youtube_video_id}` }],
            },
          },
        },
      },
    },
  ];

  const accessToken = await getAccessToken();
  const url = `${ADS_API_BASE}/customers/${customerId}/googleAds:mutate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(accessToken, { skipLoginCustomerId: client.skipLoginCustomerId }),
    body: JSON.stringify({ mutateOperations: operations }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Erro ao criar campanha Vídeo: ${text}`);
  const json = JSON.parse(text);

  let createdCampaignId = null;
  for (const r of (json.mutateOperationResponses || [])) {
    if (r.campaignResult?.resourceName) {
      createdCampaignId = r.campaignResult.resourceName.split('/').pop();
      break;
    }
  }
  return { success: true, campaign_id: createdCampaignId, raw: json };
}

// =========== HTTP Handler ===========
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    if (req.method !== 'POST') {
      return Response.json({ error: 'Use POST' }, { status: 405 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    switch (action) {
      case 'diagnose': {
        const result = await diagnose();
        return Response.json(result);
      }
      case 'inspect_accounts': {
        // Inspeciona cada conta acessível individualmente, tentando descobrir se é manager, ativa, etc.
        const accessToken = await getAccessToken();
        const devToken = (Deno.env.get('GOOGLE_ADS_DEVELOPER_TOKEN') || '').trim();
        const loginCustomerId = cleanId(Deno.env.get('GOOGLE_ADS_LOGIN_CUSTOMER_ID'));
        const listRes = await fetch(`${ADS_API_BASE}/customers:listAccessibleCustomers`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': devToken,
            'Content-Type': 'application/json',
          },
        });
        const listData = await listRes.json();
        const accountIds = (listData.resourceNames || []).map(r => r.split('/').pop());

        const details = [];
        for (const cid of accountIds) {
          const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'developer-token': devToken,
            'Content-Type': 'application/json',
          };
          if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
          const url = `${ADS_API_BASE}/customers/${cid}/googleAds:searchStream`;
          const res = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query: 'SELECT customer.id, customer.descriptive_name, customer.manager, customer.test_account, customer.status, customer.currency_code FROM customer LIMIT 1' }),
          });
          const txt = await res.text();
          let info = { id: cid, http_status: res.status };
          if (res.ok) {
            try {
              const json = JSON.parse(txt);
              const batches = Array.isArray(json) ? json : [json];
              for (const b of batches) {
                for (const r of (b.results || [])) {
                  info.descriptive_name = r.customer?.descriptiveName;
                  info.is_manager = r.customer?.manager;
                  info.is_test = r.customer?.testAccount;
                  info.status = r.customer?.status;
                  info.currency = r.customer?.currencyCode;
                }
              }
            } catch (e) { info.parse_error = e.message; }
          } else {
            info.error = txt.substring(0, 300);
          }
          details.push(info);
        }
        return Response.json({ accounts: details, login_customer_id: loginCustomerId });
      }
      case 'list_campaigns': {
        const data = await listCampaigns();
        return Response.json({ campaigns: data });
      }
      case 'get_metrics': {
        const data = await getMetrics({ date_range: body.date_range });
        return Response.json({ metrics: data });
      }
      case 'set_status': {
        const result = await setCampaignStatus({ campaign_id: body.campaign_id, status: body.status });
        return Response.json(result);
      }
      case 'create_search_campaign': {
        const result = await createSearchCampaign(body);
        return Response.json(result);
      }
      case 'create_display_campaign': {
        const result = await createDisplayCampaign(body);
        return Response.json(result);
      }
      case 'create_pmax_campaign': {
        const result = await createPerformanceMaxCampaign(body);
        return Response.json(result);
      }
      case 'create_video_campaign': {
        const result = await createVideoCampaign(body);
        return Response.json(result);
      }
      default:
        return Response.json({ error: `Ação desconhecida: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('google_ads_api error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});