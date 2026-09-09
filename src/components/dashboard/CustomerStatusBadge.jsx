import React from 'react';
import { useCustomerStatus } from '@/components/dashboard/MachineContext';
import { cn } from '@/lib/utils';

/**
 * Exibe um badge com o status atual do TICKET específico nas máquinas
 * (Lavando, Lavado, Secando, Seco, Passando, Passado, Lavando a seco, Lavado a seco).
 * Recebe o saleId (ID único do ticket) — assim apenas o ticket que realmente foi
 * para a máquina mostra o status, mesmo que outros tickets tenham o mesmo nome.
 * Não renderiza nada se o ticket não estiver em nenhuma máquina.
 */
export default function CustomerStatusBadge({ saleId }) {
  const getStatus = useCustomerStatus();
  const status = getStatus(saleId);
  if (!status) return null;
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold leading-none', status.color)}>
      {status.label}
    </span>
  );
}