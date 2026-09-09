import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid
} from 'recharts';
import { Loader2, RefreshCw, TrendingUp, Eye, MousePointerClick, DollarSign, Users } from 'lucide-react';
import CampaignAnalysis from './CampaignAnalysis';

const DATE_PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'last_90d', label: 'Últimos 90 dias' },
];

const COLORS = ['#FF6600', '#4C12A1', '#6a1cb3', '#FFB800', '#25D366', '#3b82f6'];

function KpiCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-xs text-gray-400 uppercase tracking-wide">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function CampaignResults() {
  const [datePreset, setDatePreset] = useState('last_30d');

  const { data: campaigns = [], isLoading: loadingCampaigns } = useQuery({
    queryKey: ['meta-campaigns'],
    queryFn: async () => {
      const res = await base44.functions.invoke('meta_ads_api', { action: 'list_campaigns', params: { limit: 100 } });
      return res?.data?.campaigns || [];
    },
  });

  const { data: insights = [], isLoading: loadingInsights, refetch, isFetching } = useQuery({
    queryKey: ['meta-insights', datePreset],
    queryFn: async () => {
      const res = await base44.functions.invoke('meta_ads_api', { action: 'campaign_insights', params: { date_preset: datePreset, limit: 100 } });
      return res?.data?.insights || [];
    },
  });

  const totals = insights.reduce((acc, i) => ({
    spend: acc.spend + Number(i.spend || 0),
    impressions: acc.impressions + Number(i.impressions || 0),
    clicks: acc.clicks + Number(i.clicks || 0),
    reach: acc.reach + Number(i.reach || 0),
  }), { spend: 0, impressions: 0, clicks: 0, reach: 0 });

  const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions * 100) : 0;
  const avgCpc = totals.clicks > 0 ? (totals.spend / totals.clicks) : 0;
  const avgCpm = totals.impressions > 0 ? (totals.spend / totals.impressions * 1000) : 0;

  // Dados pros gráficos
  const spendByCampaign = insights.map(i => ({
    name: (i.campaign_name || '').substring(0, 18),
    Gasto: Number(i.spend || 0),
    Cliques: Number(i.clicks || 0),
  })).slice(0, 10);

  const performanceData = insights.map(i => ({
    name: (i.campaign_name || '').substring(0, 14),
    CPC: Number(i.cpc || 0),
    CTR: Number(i.ctr || 0),
  })).slice(0, 10);

  const reachData = insights.map((i, idx) => ({
    name: (i.campaign_name || '').substring(0, 18),
    value: Number(i.reach || 0),
    fill: COLORS[idx % COLORS.length],
  })).filter(d => d.value > 0).slice(0, 6);

  if (loadingCampaigns || loadingInsights) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[#FF6600]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header com filtros */}
      <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Select value={datePreset} onValueChange={setDatePreset}>
            <SelectTrigger className="w-48 border-white/10 bg-white/5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={() => refetch()} disabled={isFetching} variant="outline" className="bg-transparent border-white/15 text-white hover:bg-white/10">
            {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </Button>
        </div>
        <Badge className="border border-[#FF6600]/30 bg-[#FF6600]/15 text-[#FF6600]">
          {insights.length} campanhas com dados
        </Badge>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Gasto total" value={`R$ ${totals.spend.toFixed(2)}`} />
        <KpiCard icon={Eye} label="Impressões" value={totals.impressions.toLocaleString('pt-BR')} sub={`CPM R$ ${avgCpm.toFixed(2)}`} />
        <KpiCard icon={MousePointerClick} label="Cliques" value={totals.clicks.toLocaleString('pt-BR')} sub={`CPC R$ ${avgCpc.toFixed(2)}`} />
        <KpiCard icon={Users} label="Alcance" value={totals.reach.toLocaleString('pt-BR')} sub={`CTR ${avgCtr.toFixed(2)}%`} />
      </div>

      {/* Análise IA — Gestor de Tráfego (sempre visível) */}
      <CampaignAnalysis
        insights={insights}
        totals={totals}
        campaigns={campaigns}
        datePresetLabel={DATE_PRESETS.find(p => p.value === datePreset)?.label || datePreset}
      />

      {insights.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-gray-400">
          <TrendingUp className="w-10 h-10 mx-auto mb-3 text-gray-500" />
          Nenhuma campanha com dados no período selecionado.
          <div className="text-xs text-gray-500 mt-1">Crie e ative campanhas no Gerenciador de Anúncios para ver métricas aqui.</div>
        </div>
      ) : (
        <>
          {/* Gráfico de barras: gasto por campanha */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
            <h3 className="font-semibold text-white mb-4">Gasto e cliques por campanha</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={spendByCampaign}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                <XAxis dataKey="name" stroke="#888" fontSize={11} />
                <YAxis stroke="#888" fontSize={11} />
                <Tooltip contentStyle={{ background: '#1a0b36', border: '1px solid #ffffff20', borderRadius: 8 }} />
                <Legend />
                <Bar dataKey="Gasto" fill="#FF6600" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Cliques" fill="#4C12A1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pizza alcance */}
            {reachData.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                <h3 className="font-semibold text-white mb-4">Distribuição de alcance</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={reachData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.name}`}>
                      {reachData.map((entry, idx) => <Cell key={idx} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1a0b36', border: '1px solid #ffffff20', borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Linha CPC/CTR */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
              <h3 className="font-semibold text-white mb-4">Performance (CPC × CTR)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={performanceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff15" />
                  <XAxis dataKey="name" stroke="#888" fontSize={11} />
                  <YAxis stroke="#888" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#1a0b36', border: '1px solid #ffffff20', borderRadius: 8 }} />
                  <Legend />
                  <Line type="monotone" dataKey="CPC" stroke="#FF6600" strokeWidth={2} />
                  <Line type="monotone" dataKey="CTR" stroke="#4C12A1" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tabela de campanhas */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl overflow-x-auto">
            <h3 className="font-semibold text-white mb-4">Detalhes por campanha</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-400 border-b border-white/10">
                  <th className="p-2">Campanha</th>
                  <th className="p-2">Gasto</th>
                  <th className="p-2">Impressões</th>
                  <th className="p-2">Cliques</th>
                  <th className="p-2">CTR</th>
                  <th className="p-2">CPC</th>
                  <th className="p-2">Alcance</th>
                </tr>
              </thead>
              <tbody>
                {insights.map((i) => (
                  <tr key={i.campaign_id} className="border-b border-white/5 text-gray-300">
                    <td className="p-2 text-white font-medium">{i.campaign_name}</td>
                    <td className="p-2">R$ {Number(i.spend || 0).toFixed(2)}</td>
                    <td className="p-2">{Number(i.impressions || 0).toLocaleString('pt-BR')}</td>
                    <td className="p-2">{Number(i.clicks || 0).toLocaleString('pt-BR')}</td>
                    <td className="p-2">{Number(i.ctr || 0).toFixed(2)}%</td>
                    <td className="p-2">R$ {Number(i.cpc || 0).toFixed(2)}</td>
                    <td className="p-2">{Number(i.reach || 0).toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Lista de campanhas (status) */}
      {campaigns.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
          <h3 className="font-semibold text-white mb-4">Todas as campanhas na conta</h3>
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-black/20 border border-white/5">
                <div>
                  <div className="text-white font-medium">{c.name}</div>
                  <div className="text-xs text-gray-500">{c.objective}</div>
                </div>
                <Badge className={
                  c.status === 'ACTIVE' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                  c.status === 'PAUSED' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  'bg-white/10 text-gray-400'
                }>
                  {c.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}