import { base44 } from '@/api/base44Client';

const PAGE_SIZE = 5000;
const MAX_PAGES = 8;

// Busca todas as páginas de clientes em paralelo para reduzir o tempo de carga.
// Primeiro busca a página 0; se vier cheia, dispara as demais páginas em paralelo.
export async function loadAllCustomers() {
  const first = await base44.entities.Customer.list('full_name', PAGE_SIZE, 0);
  if (first.length < PAGE_SIZE) return first;

  const pages = [first];
  const remaining = [];
  for (let page = 1; page < MAX_PAGES; page++) {
    remaining.push(
      base44.entities.Customer.list('full_name', PAGE_SIZE, page * PAGE_SIZE)
        .catch(() => [])
    );
  }
  const rest = await Promise.all(remaining);
  for (const chunk of rest) {
    if (chunk.length) pages.push(chunk);
  }
  return pages.flat();
}