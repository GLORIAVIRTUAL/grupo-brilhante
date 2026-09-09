import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Scale } from 'lucide-react';

const fmt = (value) => `R$ ${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DRESection({ dre }) {
  const { totalRevenue, totalExpenses, netResult, revenueByCategory, expensesByCategory } = dre;
  const margin = totalRevenue > 0 ? (netResult / totalRevenue) * 100 : 0;
  const isPositive = netResult >= 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Receitas Totais</CardTitle>
            <TrendingUp className="h-4 w-4 text-[#25D366]" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-[#25D366]">{fmt(totalRevenue)}</div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Despesas Totais</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{fmt(totalExpenses)}</div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-white/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">Resultado Líquido</CardTitle>
            <Scale className={`h-4 w-4 ${isPositive ? 'text-[#25D366]' : 'text-red-500'}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${isPositive ? 'text-[#25D366]' : 'text-red-500'}`}>{fmt(netResult)}</div>
            <p className="mt-1 text-xs text-gray-500">Margem: {margin.toFixed(1)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-white">Demonstrativo de Resultados (DRE)</CardTitle>
          <CardDescription className="text-gray-300">Receitas, despesas e resultado do período</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between border-b border-white/10 py-2 font-semibold text-[#25D366]">
              <span>(+) Receitas</span>
              <span>{fmt(totalRevenue)}</span>
            </div>
            {revenueByCategory.map((row) => (
              <div key={row.name} className="flex items-center justify-between py-1 pl-4 text-gray-300">
                <span>{row.name}</span>
                <span>{fmt(row.value)}</span>
              </div>
            ))}

            <div className="flex items-center justify-between border-b border-white/10 py-2 pt-4 font-semibold text-red-400">
              <span>(−) Despesas</span>
              <span>{fmt(totalExpenses)}</span>
            </div>
            {expensesByCategory.map((row) => (
              <div key={row.name} className="flex items-center justify-between py-1 pl-4 text-gray-300">
                <span>{row.name}</span>
                <span>{fmt(row.value)}</span>
              </div>
            ))}

            <div className={`mt-4 flex items-center justify-between rounded-lg border px-3 py-3 text-base font-bold ${isPositive ? 'border-[#25D366]/30 bg-[#25D366]/10 text-[#25D366]' : 'border-red-500/30 bg-red-500/10 text-red-400'}`}>
              <span>(=) Resultado Líquido</span>
              <span>{fmt(netResult)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}