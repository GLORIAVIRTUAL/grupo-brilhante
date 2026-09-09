import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCcw, Pause, Play, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import GoogleAdsAIAnalysis from './GoogleAdsAIAnalysis';

const STATUS_LABELS = { ENABLED: 'Ativa', PAUSED: 'Pausada', REMOVED: 'Removida' };
const STATUS_COLORS = {
  ENABLED: 'bg-green-500/20 text-green-400',
  PAUSED: 'bg-yellow-500/20 text-yellow-400',
  REMOVED: 'bg-red-500/20 text-red-400',
};

export default function GoogleAdsResults() {
  const [campaigns, setCampaigns] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, m] = await Promise.all([
        base44.functions.invoke('google_ads_api', { action: 'list_campaigns' }),
        base44.functions.invoke('google_ads_api', { action: 'get_metrics', date_range: 'LAST_30_DAYS' }),
      ]);
      setCampaigns(c.data.campaigns || []);
      setMetrics(m.data.metrics || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleStatus = async (campaign) => {
    const newStatus = campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED';
    try {
      await base44.functions.invoke('google_ads_api', {
        action: 'set_status',
        campaign_id: campaign.id,
        status: newStatus,
      });
      toast.success(`Campanha ${newStatus === 'ENABLED' ? 'ativada' : 'pausada'}`);
      load();
    } catch (e) {
      toast.error(`Falha: ${e.response?.data?.error || e.message}`);
    }
  };

  // Junta dados de campanhas e métricas
  const merged = campaigns.map(c => {
    const m = metrics.find(x => String(x.campaign_id) === String(c.id)) || {};
    return { ...c, ...m };
  });

  // Totais
  const totals = merged.reduce((acc, x) => ({
    impressions: acc.impressions + (x.impressions || 0),
    clicks: acc.clicks + (x.clicks || 0),
    cost: acc.cost + (x.cost_brl || 0),
    conversions: acc.conversions + (x.conversions || 0),
  }), { impressions: 0, clicks: 0, cost: 0, conversions: 0 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
          <BarChart3 className="w-5 h-5 text-[#FF6600]" />
          Resultados (últimos 30 dias)
        </h3>
        <Button onClick={load} disabled={loading} variant="outline" className="border-white/10">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
        </Button>
      </div>

      {error && (
        <Card className="bg-red-500/10 border-red-500/30 p-4 text-red-300 text-sm">
          <pre className="whitespace-pre-wrap text-xs">{error}</pre>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-white/5 border-white/10 p-4 text-white">
          <div className="text-xs text-gray-400 uppercase">Impressões</div>
          <div className="text-2xl font-bold text-white mt-1">{totals.impressions.toLocaleString('pt-BR')}</div>
        </Card>
        <Card className="bg-white/5 border-white/10 p-4 text-white">
          <div className="text-xs text-gray-400 uppercase">Cliques</div>
          <div className="text-2xl font-bold text-white mt-1">{totals.clicks.toLocaleString('pt-BR')}</div>
        </Card>
        <Card className="bg-white/5 border-white/10 p-4 text-white">
          <div className="text-xs text-gray-400 uppercase">Investido</div>
          <div className="text-2xl font-bold text-[#FF6600] mt-1">R$ {totals.cost.toFixed(2)}</div>
        </Card>
        <Card className="bg-white/5 border-white/10 p-4 text-white">
          <div className="text-xs text-gray-400 uppercase">Conversões</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{totals.conversions.toFixed(0)}</div>
        </Card>
      </div>

      <GoogleAdsAIAnalysis campaigns={merged} totals={totals} />

      <Card className="bg-white/5 border-white/10 overflow-hidden text-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Campanha</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Impressões</th>
                <th className="px-4 py-3 text-right">Cliques</th>
                <th className="px-4 py-3 text-right">CTR</th>
                <th className="px-4 py-3 text-right">CPC médio</th>
                <th className="px-4 py-3 text-right">Investido</th>
                <th className="px-4 py-3 text-right">Conversões</th>
                <th className="px-4 py-3 text-center">Ação</th>
              </tr>
            </thead>
            <tbody>
              {merged.length === 0 && !loading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">Nenhuma campanha encontrada</td></tr>
              )}
              {merged.map(c => (
                <tr key={c.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 text-white">{c.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[c.status] || 'bg-white/10'}`}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-300">{(c.impressions || 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{(c.clicks || 0).toLocaleString('pt-BR')}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{((c.ctr || 0) * 100).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right text-gray-300">R$ {(c.avg_cpc_brl || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-[#FF6600] font-semibold">R$ {(c.cost_brl || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-green-400">{(c.conversions || 0).toFixed(0)}</td>
                  <td className="px-4 py-3 text-center">
                    {c.status !== 'REMOVED' && (
                      <button
                        onClick={() => toggleStatus(c)}
                        className="p-1.5 rounded hover:bg-white/10"
                        title={c.status === 'ENABLED' ? 'Pausar' : 'Ativar'}
                      >
                        {c.status === 'ENABLED'
                          ? <Pause className="w-4 h-4 text-yellow-400" />
                          : <Play className="w-4 h-4 text-green-400" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}