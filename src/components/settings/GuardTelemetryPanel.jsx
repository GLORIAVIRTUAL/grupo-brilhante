import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';

const GUARD_LABELS = {
  hallucinationGuard: 'Correção de FATO (valor/data/prazo)',
  hallucinationGuard_cosmetic: 'Apenas reescrita de texto (sem erro de fato)',
  pickup_confirmation_without_schedule: 'Confirmou coleta sem agendar',
  availability_claim_without_check: 'Afirmou indisponibilidade sem consultar',
  availability_offer_without_check: 'Ofereceu data/turno sem consultar vagas',
  approve_quote_price_correction: 'Preço divergente do catálogo',
  enforceVariableQuoteSafety: 'Faltou aviso de inspeção/menor valor',
  enforceDeliveryFeeNotice: 'Faltou taxa de R$ 15,00',
  empty_response: 'Resposta vazia da IA'
};

const PERIODS = [
  { days: 1, label: 'Hoje' },
  { days: 7, label: '7 dias' },
  { days: 14, label: '14 dias' },
  { days: 30, label: '30 dias' }
];

export default function GuardTelemetryPanel() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const load = async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const all = await base44.entities.StaffNotification.filter({
      type: 'SYSTEM_ERROR',
      target_team: 'ai_quality'
    }, '-created_date', 500);
    setEvents(all.filter((e) => (e.sent_at || e.created_date) >= since));
    setLoading(false);
  };

  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranking = Object.entries(
    events.reduce((acc, e) => {
      const guard = e.payload?.guard || 'desconhecido';
      acc[guard] = (acc[guard] || 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-orange-400" /> Telemetria dos Guardas da Glória
            </CardTitle>
            <CardDescription className="text-gray-400">
              Cada vez que um guarda corrige um erro da Glória, o evento é registrado aqui com a conversa e o trecho.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {PERIODS.map((p) => (
              <Button
                key={p.days}
                size="sm"
                variant={days === p.days ? 'default' : 'outline'}
                onClick={() => setDays(p.days)}
                className={days === p.days ? 'bg-[#FF6600] hover:bg-[#ff7b24] text-white' : 'border-white/10 text-gray-300 hover:bg-white/5'}
              >
                {p.label}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={load} className="border-white/10 text-gray-300 hover:bg-white/5">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>
          ) : ranking.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">Nenhum erro registrado neste período. 🎉</p>
          ) : (
            <div className="space-y-2">
              {ranking.map(([guard, count]) => (
                <div key={guard} className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{GUARD_LABELS[guard] || guard}</p>
                    <p className="text-xs text-gray-500">{guard}</p>
                  </div>
                  <span className="text-lg font-bold text-[#FF6600]">{count}</span>
                </div>
              ))}
              <p className="text-xs text-gray-500 pt-2">Total no período: {events.length} correções.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
        <CardHeader>
          <CardTitle>Últimas ocorrências</CardTitle>
          <CardDescription className="text-gray-400">Detalhe de cada correção, com o trecho da mensagem original.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center p-8"><Loader2 className="animate-spin text-[#FF6600]" /></div>
          ) : events.length === 0 ? (
            <p className="text-sm text-gray-400">Sem ocorrências.</p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {events.map((e) => (
                <div key={e.id} className="bg-black/20 border border-white/5 rounded-lg p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 mb-2">
                    <span className="px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 border border-orange-500/20">
                      {GUARD_LABELS[e.payload?.guard] || e.payload?.guard || 'desconhecido'}
                    </span>
                    <span>{new Date(e.sent_at || e.created_date).toLocaleString('pt-BR')}</span>
                    {e.payload?.customer_name && <span>• {e.payload.customer_name}</span>}
                  </div>
                  {e.payload?.detail && <p className="text-sm text-gray-200 mb-2">{e.payload.detail}</p>}
                  {e.payload?.excerpt && (
                    <p className="text-xs text-gray-400 font-mono bg-black/30 rounded p-2 whitespace-pre-wrap break-words">
                      {e.payload.excerpt}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}