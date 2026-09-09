import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, Loader2, Stethoscope } from 'lucide-react';

export default function GoogleAdsDiagnose() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleDiagnose = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('google_ads_api', { action: 'diagnose' });
      setResult(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-white/5 backdrop-blur-xl border-white/10 p-6 text-white">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
            <Stethoscope className="w-5 h-5 text-[#FF6600]" />
            Diagnóstico da Conexão
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Testa se as credenciais do Google Ads estão funcionando.
          </p>
        </div>
        <Button onClick={handleDiagnose} disabled={loading} className="bg-[#FF6600] hover:bg-[#FF6600]/90">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Testar Conexão'}
        </Button>
      </div>

      {error && (
        <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          <div className="flex items-center gap-2 font-semibold mb-2">
            <AlertTriangle className="w-4 h-4" />
            Erro
          </div>
          <pre className="whitespace-pre-wrap text-xs">{error}</pre>
        </div>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className={`p-4 rounded-lg border ${result.success ? 'bg-green-500/10 border-green-500/30 text-green-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
            <div className="flex items-center gap-2 font-semibold">
              {result.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {result.success ? 'Conexão OK!' : 'Falha na conexão'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-white/5">
              <span className="text-gray-400">Developer Token:</span>{' '}
              <span className={result.has_developer_token ? 'text-green-400' : 'text-red-400'}>
                {result.has_developer_token ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <span className="text-gray-400">Access Token:</span>{' '}
              <span className={result.has_access_token ? 'text-green-400' : 'text-red-400'}>
                {result.has_access_token ? '✓' : '✗'}
              </span>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <span className="text-gray-400">Customer ID:</span>{' '}
              <span className="text-white">{result.customer_id}</span>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <span className="text-gray-400">Login Customer ID:</span>{' '}
              <span className="text-white">{result.login_customer_id || '—'}</span>
            </div>
          </div>
          {result.accessible_customers?.length > 0 && (
            <div className="p-3 rounded-lg bg-white/5 text-sm">
              <div className="text-gray-400 mb-1">Contas acessíveis:</div>
              <ul className="text-white space-y-1">
                {result.accessible_customers.map(c => (
                  <li key={c} className="font-mono text-xs">{c}</li>
                ))}
              </ul>
            </div>
          )}
          {result.raw && (
            <details className="text-xs">
              <summary className="text-gray-400 cursor-pointer">Resposta bruta</summary>
              <pre className="mt-2 p-3 bg-black/30 rounded overflow-auto">{JSON.stringify(result.raw, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}