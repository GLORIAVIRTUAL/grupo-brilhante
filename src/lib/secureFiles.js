import { base44 } from '@/api/base44Client';

const FILE_POLICIES = {
  garment_photo: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  garment_label: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  garment_damage: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  purchase_invoice: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml'], maxBytes: 15 * 1024 * 1024 },
  utility_bill: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  service_invoice: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/xml', 'text/xml'], maxBytes: 15 * 1024 * 1024 },
  payment_receipt: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
  delivery_proof: { types: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  third_party_document: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  corporate_document: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  contract: { types: ['application/pdf'], maxBytes: 15 * 1024 * 1024 },
  contract_addendum: { types: ['application/pdf'], maxBytes: 15 * 1024 * 1024 },
  tax_document: { types: ['application/pdf', 'application/xml', 'text/xml'], maxBytes: 15 * 1024 * 1024 },
  bank_document: { types: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv', 'text/plain', 'application/x-ofx', 'application/octet-stream'], maxBytes: 15 * 1024 * 1024 },
  employee_document: { types: ['image/jpeg', 'image/png', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  hospital_document: { types: ['image/jpeg', 'image/png', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  linen_liability_term: { types: ['application/pdf'], maxBytes: 15 * 1024 * 1024 },
  cleaning_evidence: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 15 * 1024 * 1024 },
  migration_source: { types: ['text/csv', 'text/plain', 'application/json', 'application/xml', 'text/xml'], maxBytes: 15 * 1024 * 1024 },
  other: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
};

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/x-ofx': 'ofx',
  'application/octet-stream': 'txt',
};

export function getFilePolicy(documentType) {
  return FILE_POLICIES[documentType] || FILE_POLICIES.other;
}

export function validateFile(file, documentType) {
  if (!(file instanceof File)) throw new Error('Selecione um arquivo válido.');
  const policy = getFilePolicy(documentType);
  if (!policy.types.includes(file.type)) throw new Error('Tipo de arquivo não permitido para esta categoria documental.');
  if (file.size <= 0) throw new Error('O arquivo está vazio.');
  if (file.size > policy.maxBytes) throw new Error(`O arquivo ultrapassa o limite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`);
  return policy;
}

export async function sha256Hex(file) {
  const data = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function uploadSecureFile({ file, documentType, unitId, legalEntityId = null, customerId = null, relatedEntityType = null, relatedEntityId = null, classification = 'internal', retentionClass = null, reason = null, metadata = {} }) {
  validateFile(file, documentType);
  if (!unitId) throw new Error('Selecione uma unidade antes de enviar o documento.');

  const hash = await sha256Hex(file);
  const extension = EXTENSIONS[file.type];
  const safeFilename = `${crypto.randomUUID()}.${extension}`;
  const safeFile = new File([file], safeFilename, { type: file.type, lastModified: Date.now() });

  let resolvedLegalEntityId = legalEntityId;
  if (!resolvedLegalEntityId) {
    const unit = await base44.entities.Unit.get(unitId);
    resolvedLegalEntityId = unit?.legal_entity_id;
  }
  if (!resolvedLegalEntityId) throw new Error('A unidade ainda não está vinculada a um CNPJ. Faça a vinculação antes do envio.');

  const { file_url: storageKey } = await base44.integrations.Core.UploadFile({ file: safeFile });
  try {
    const response = await base44.functions.invoke('manage_document_assets', {
      action: 'register',
      legal_entity_id: resolvedLegalEntityId,
      unit_id: unitId,
      customer_id: customerId || undefined,
      related_entity_type: relatedEntityType || undefined,
      related_entity_id: relatedEntityId || undefined,
      document_type: documentType,
      storage_key: storageKey,
      original_filename: file.name.slice(0, 180),
      safe_filename: safeFilename,
      mime_type: file.type,
      size_bytes: file.size,
      sha256: hash,
      classification,
      retention_class: retentionClass,
      visibility: 'private',
      reason: reason || `Envio autenticado de documento ${documentType}`,
      metadata,
    });
    const asset = response?.data?.asset || response?.asset;
    return { asset, storageKey, hash };
  } catch (error) {
    if (error?.response?.status === 409 || error?.data?.error === 'duplicate_document') {
      const duplicateError = Object.assign(new Error('Este documento já foi enviado para a unidade selecionada.'), {
        code: 'DUPLICATE_DOCUMENT',
        assetId: error?.response?.data?.asset_id || error?.data?.asset_id,
      });
      throw duplicateError;
    }
    throw error;
  }
}
