import React from 'react';
import { CheckCircle2, Clock, CircleDollarSign } from 'lucide-react';

const CONFIG = {
  paid: { label: 'PAGAMENTO CONFIRMADO', cls: 'bg-[#25D366]/20 text-[#25D366] border-[#25D366]/40', Icon: CheckCircle2 },
  partial: { label: 'PAGAMENTO PARCIAL', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40', Icon: CircleDollarSign },
  pending_confirmation: { label: 'AGUARDANDO CONFIRMAÇÃO', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/40', Icon: Clock },
  refunded: { label: 'ESTORNADO', cls: 'bg-red-500/20 text-red-300 border-red-500/40', Icon: CircleDollarSign },
  cancelled: { label: 'CANCELADO', cls: 'bg-red-500/20 text-red-300 border-red-500/40', Icon: CircleDollarSign },
  unpaid: { label: 'SÓ ORÇAMENTO (NÃO PAGO)', cls: 'bg-white/10 text-gray-300 border-white/20', Icon: Clock }
};

export default function PaymentStatusBadge({ status, compact = false }) {
  const conf = CONFIG[status] || CONFIG.unpaid;
  const { Icon } = conf;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${conf.cls}`}
      title={conf.label}
    >
      <Icon className="h-3 w-3" />
      {compact ? (status === 'paid' ? 'PAGO' : conf.label.split(' ')[0]) : conf.label}
    </span>
  );
}