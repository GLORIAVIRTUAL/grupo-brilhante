import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';

export default function IntegrationReadiness() {
  const { data, isLoading } = useQuery({
    queryKey: ['integration-readiness'],
    queryFn: async () => {
      try {
        const response = await base44.functions.invoke('integration_status', {});
        return response.data;
      } catch (error) {
        return { unavailable: true, integrations: [], error };
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) return <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" />Verificando integrações…</div>;
  if (data?.unavailable) return null;

  const integrations = data?.integrations || [];
  const configured = integrations.filter((item) => item.configured).length;
  const pending = integrations.length - configured;

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-white/5 p-2 text-violet-300"><KeyRound className="h-4 w-4" /></div><div><p className="text-sm font-semibold text-white">Prontidão das integrações</p><p className="text-xs text-white/40">Os segredos ficam no ambiente da plataforma, nunca no código.</p></div></div>
        <div className="flex flex-wrap gap-2">{integrations.map((integration) => <Badge key={integration.id} variant="outline" className={integration.configured ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-200'}>{integration.configured ? <Check className="mr-1 h-3 w-3" /> : <CircleAlert className="mr-1 h-3 w-3" />}{integration.display_name}</Badge>)}</div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-white/40"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />{configured} configurada(s) · {pending} aguardando segredo(s) · endpoints internos {data?.debug_endpoints_enabled ? 'habilitados' : 'bloqueados'}</div>
    </div>
  );
}
