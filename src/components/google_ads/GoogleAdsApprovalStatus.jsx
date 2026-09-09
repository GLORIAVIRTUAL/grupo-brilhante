import React from 'react';
import { Card } from '@/components/ui/card';
import { Clock, CheckCircle2, ExternalLink, Mail } from 'lucide-react';

export default function GoogleAdsApprovalStatus() {
  const steps = [
    { label: 'Conta Manager (MCC) criada', done: true },
    { label: 'OAuth Client configurado no Google Cloud', done: true },
    { label: 'Refresh Token gerado', done: true },
    { label: 'Google Ads API ativada no Google Cloud', done: true },
    { label: 'Developer Token solicitado', done: true },
    { label: 'Documento de design enviado ao Google', done: true },
    { label: 'Aprovação do Developer Token (Basic Access)', done: true },
  ];

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/30 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-green-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-green-100">Basic Access aprovado! 🎉</h3>
            <p className="text-sm text-green-200/80 mt-1">
              Seu <strong>Developer Token</strong> foi aprovado com <strong>Basic Access</strong> e a integração com o
              Google Ads já está ativa. Você já pode <strong>criar campanhas reais</strong> diretamente pela aba
              <strong> Criar Campanha</strong>.
            </p>
          </div>
        </div>
      </Card>

      <Card className="bg-white/5 border-white/10 p-6 text-white">
        <h4 className="font-semibold mb-4 text-white">Checklist de configuração</h4>
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                s.done ? 'bg-green-500/20' : s.pending ? 'bg-yellow-500/20' : 'bg-white/10'
              }`}>
                {s.done ? <CheckCircle2 className="w-4 h-4 text-green-400" /> :
                  s.pending ? <Clock className="w-4 h-4 text-yellow-400 animate-pulse" /> :
                  <span className="text-gray-400 text-xs">{i + 1}</span>}
              </div>
              <span className={`text-sm ${s.done ? 'text-gray-300' : s.pending ? 'text-yellow-200 font-medium' : 'text-gray-400'}`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="bg-white/5 border-white/10 p-5 text-white">
          <div className="flex items-center gap-2 mb-2">
            <ExternalLink className="w-4 h-4 text-[#FF6600]" />
            <h4 className="font-semibold text-white text-sm">Acompanhar status</h4>
          </div>
          <p className="text-xs text-gray-400 mb-3">
            Verifique o status do seu Developer Token na Central de API.
          </p>
          <a
            href="https://ads.google.com/aw/apicenter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF6600] text-sm hover:underline inline-flex items-center gap-1"
          >
            Abrir Central de API <ExternalLink className="w-3 h-3" />
          </a>
        </Card>

        <Card className="bg-white/5 border-white/10 p-5 text-white">
          <div className="flex items-center gap-2 mb-2">
            <Mail className="w-4 h-4 text-[#FF6600]" />
            <h4 className="font-semibold text-white text-sm">Notificação por email</h4>
          </div>
          <p className="text-xs text-gray-400">
            O Google enviará um email para o endereço cadastrado quando a revisão for concluída.
            Verifique também a caixa de spam.
          </p>
        </Card>
      </div>

      <Card className="bg-green-500/5 border-green-500/20 p-5">
        <h4 className="font-semibold text-green-300 text-sm mb-2">🚀 Tudo pronto! Próximos passos</h4>
        <ul className="space-y-1.5 text-sm text-green-200/80">
          <li>• Vá para a aba <strong>Criar Campanha</strong> e envie sua primeira campanha real</li>
          <li>• Use a <strong>Pesquisa IA</strong> para gerar estratégias e aplicar direto na criação</li>
          <li>• Acompanhe o desempenho na aba <strong>Resultados</strong></li>
        </ul>
      </Card>
    </div>
  );
}