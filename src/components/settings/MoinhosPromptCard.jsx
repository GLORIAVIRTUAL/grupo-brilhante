import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Store, CheckCircle2 } from "lucide-react";

// Prompt ADICIONAL exclusivo da loja Moinhos Shopping (2ª conexão Z-API).
// Reflete o bloco de identidade que o orchestrator injeta quando a conversa vem de Moinhos.
// Somente leitura: garante que preços/serviços/coleta continuam iguais aos da rede.
const MOINHOS_PROMPT = `🏪 IDENTIDADE FIXA — LOJA MOINHOS SHOPPING (2ª conexão Z-API)

Este atendimento é EXCLUSIVO da unidade Moinhos Shopping. Você é a Glória, atendente da 5àsec Moinhos Shopping. TODAS as regras de preços, serviços, catálogo, orçamento, coleta e pagamento da rede continuam valendo integralmente — muda APENAS a loja de referência:

• Ao se apresentar, diga que é a Glória da 5àsec Moinhos Shopping (não cite outras lojas).
• É proibido listar, oferecer ou sugerir qualquer OUTRA loja.
• Se o cliente pedir endereço/telefone/localização, forneça SOMENTE os dados da loja Moinhos.

📍 DADOS FIXOS DA LOJA MOINHOS
🏪 5àsec Moinhos Shopping
📌 Rua Olavo Barreto Viana, 36 — Loja C (Subsolo 1) — Moinhos de Vento, Porto Alegre/RS
📞 Fixo: (51) 3273-7823  |  📱 Celular: (51) 98992-5334
🕒 Seg a Sáb 11h-20h | Dom/Feriados: Fechado`;

export default function MoinhosPromptCard() {
  return (
    <Card className="bg-white/5 border-white/10 backdrop-blur-sm text-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Store className="w-5 h-5 text-orange-400" />
          Prompt da Loja Moinhos Shopping
        </CardTitle>
        <CardDescription className="text-gray-400">
          Instrução ADICIONAL aplicada somente às conversas da 2ª conexão (Moinhos).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 p-3 rounded-md bg-green-500/10 border border-green-500/30">
          <p className="text-sm text-green-200 font-medium flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-400" />
            <span>
              A Glória de Moinhos faz <strong>exatamente tudo</strong> que a Glória geral faz — o
              "Prompt da Rede (Geral)" acima vale integralmente também para Moinhos: catálogo,
              preços, bags, planos, serviços especiais, coleta/entrega, pagamento, agendamento,
              prazos e todas as ferramentas.
            </span>
          </p>
          <p className="text-xs text-green-300/80 mt-2 pl-6">
            O texto abaixo é apenas um <strong>bloco extra de identidade</strong> somado ao final
            do prompt geral, que fixa a loja Moinhos (endereço, telefones e horário próprios) e
            impede a Glória de citar outras unidades. Nada é removido — só é acrescentado.
          </p>
        </div>
        <pre className="min-h-[200px] max-h-[400px] overflow-y-auto whitespace-pre-wrap bg-white/5 border border-white/10 rounded-md p-4 font-mono text-sm leading-relaxed text-gray-200">
{MOINHOS_PROMPT}
        </pre>
        <p className="text-xs text-gray-500 mt-3">
          Este bloco é somado automaticamente ao Prompt da Rede no atendimento automático. Para alterar o texto fixo da loja, peça o ajuste.
        </p>
      </CardContent>
    </Card>
  );
}