import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Wallet, Clock, CreditCard, PiggyBank } from 'lucide-react';

const fmt = (v) => `R$ ${Number(v || 0).toFixed(2)}`;

export default function ManagementStats({ totalIncome, totalExpense, balance, avgDeliveryDays, totalCardFees, netProfit }) {
  const cards = [
    { label: 'Entradas', value: fmt(totalIncome), icon: TrendingUp, color: 'text-[#25D366]' },
    { label: 'Saídas', value: fmt(totalExpense), icon: TrendingDown, color: 'text-red-400' },
    { label: 'Taxas de Cartão', value: fmt(totalCardFees), icon: CreditCard, color: 'text-amber-400' },
    { label: 'Saldo', value: fmt(balance), icon: Wallet, color: balance >= 0 ? 'text-[#FF6600]' : 'text-red-400' },
    { label: 'Lucro Líquido', value: fmt(netProfit), icon: PiggyBank, color: (netProfit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Prazo Médio de Entrega', value: avgDeliveryDays != null ? `${avgDeliveryDays.toFixed(1)} dias` : '—', icon: Clock, color: 'text-[#4C12A1]' }
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">{c.label}</CardTitle>
            <c.icon className={`h-4 w-4 ${c.color}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}