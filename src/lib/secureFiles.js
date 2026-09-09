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
  other: { types: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], maxBytes: 10 * 1024 * 1024 },
};

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

export function getFilePolicy(documentType) {
  return FILE_POLICIES[documentType] || FILE_POLICIES.other;
}

export function validateFile(file, documentType) {
  if (!(file instanceof File)) throw new Error('Selecione um arquivo válido.');
  const policy = getFilePolicy(documentType);
  if (!policy.types.includes(file.type)) throw new Error('Tipo de arquivo não permitido. Use JPG, PNG, WEBP, PDF ou XML conforme o documento.');
  if (file.size <= 0) throw new Error('O arquivo está vazio.');
  if (file.size > policy.maxBytes) throw new Error(`O arquivo ultrapassa o limite de ${Math.round(policy.maxBytes / 1024 / 1024)} MB.`);
  return policy;
}

export async function sha256Hex(file) {
  const data = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function uploadSecureFile({ file, documentType, unitId, customerId, metadata = {} }) {
  validateFile(file, documentType);
  if (!unitId) throw new Error('Selecione uma unidade antes de enviar o documento.');

  const hash = await sha256Hex(file);
  const extension = EXTENSIONS[file.type];
  const safeFilename = `${crypto.randomUUID()}.${extension}`;
  const safeFile = new File([file], safeFilename, { type: file.type, lastModified: Date.now() });

  const duplicateAssets = await base44.entities.DocumentAsset.filter({ sha256: hash });
  const duplicate = duplicateAssets.find((asset) => asset.unit_id === unitId && asset.document_type === documentType);
  if (duplicate) {
    const error = new Error('Este documento já foi enviado para a unidade selecionada.');
    error.code = 'DUPLICATE_DOCUMENT';
    error.asset = duplicate;
    throw error;
  }

  const { file_url: storageKey } = await base44.integrations.Core.UploadFile({ file: safeFile });
  const asset = await base44.entities.DocumentAsset.create({
    unit_id: unitId,
    customer_id: customerId || undefined,
    document_type: documentType,
    storage_key: storageKey,
    original_filename: file.name.slice(0, 180),
    safe_filename: safeFilename,
    mime_type: file.type,
    size_bytes: file.size,
    sha256: hash,
    scan_status: 'not_configured',
    validation_status: 'valid',
    visibility: 'private',
    metadata,
  });

  return { asset, storageKey, hash };
}
