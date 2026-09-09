import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, MessageSquare, Banknote, Send, Megaphone } from 'lucide-react';
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Essencial",
    subtitle: "Atendimento + Gestão",
    price: "489",
    icon: Banknote,
    highlight: false,
    features: [
      "Atendimento ilimitado 24/7 com IA (texto, áudio e foto)",
      "Orçamentos automáticos com revisão humana",
      "Integração WhatsApp (Z-API) e pagamentos Stripe",
      "Coletas e agendamentos (automáticos e manuais)",
      "Melhor rota de entrega do dia por endereço",
      "Coletas prioritárias, recorrentes e encaixes",
      "Gestão financeira: entradas, saídas e fluxo de caixa",
      "Geração de tickets de serviço",
      "Dashboard de gestão por unidade",
    ]
  },
  {
    name: "Performance",
    subtitle: "Atendimento + Gestão + Disparos",
    price: "692",
    icon: Send,
    highlight: true,
    features: [
      "Tudo do plano Essencial",
      "Disparos automáticos e manuais no WhatsApp",
      "Recuperação de clientes inativos",
      "Mensagens de aniversário",
      "Promoções e campanhas de relacionamento",
      "Pesquisa de satisfação",
      "Disparos manuais ou pré-programados",
      "Contabilização do retorno dos disparos",
      "Relatório de conversão dos disparos",
    ]
  },
  {
    name: "Máquina de Crescimento",
    subtitle: "Atendimento + Gestão + Disparos + Marketing",
    price: "985",
    icon: Megaphone,
    highlight: false,
    features: [
      "Tudo do plano Performance",
      "Criação de designs com texto, marca, imagem e legenda",
      "Publicação direta nas redes sociais da unidade",
      "Geração de vídeo a partir da arte criada",
      "Importar e agendar artes da franqueadora (dia e hora)",
      "Tráfego pago Meta com estratégia criada por IA",
      "Google Ads: palavras-chave, headlines e descriptions por IA",
      "Campanhas de Pesquisa, Display, Performance Max e YouTube",
      "Resultados e uso de verba (Meta e Google) com pausar/criar campanhas",
    ]
  }
];

export default function PricingSection() {
  return (
    <section id="preco" className="py-24 bg-[#1a0b36] text-white relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#FF6600]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10 text-center">
         <h2 className="text-3xl md:text-4xl font-bold mb-14">Escolha o plano da sua unidade</h2>

        <div className="grid lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className={`relative flex flex-col text-left bg-white/5 backdrop-blur-xl rounded-3xl p-8 transition-colors shadow-2xl ${
                plan.highlight ? 'border-2 border-[#FF6600] lg:scale-105' : 'border border-white/10 hover:border-[#FF6600]/50'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#FF6600] text-white text-xs font-bold uppercase tracking-wider px-4 py-1 rounded-full">
                  Mais popular
                </span>
              )}

              <div className="w-12 h-12 rounded-xl bg-[#FF6600]/15 flex items-center justify-center mb-5">
                <plan.icon className="w-6 h-6 text-[#FF6600]" />
              </div>

              <h3 className="text-2xl font-bold">{plan.name}</h3>
              <p className="text-sm text-gray-400 mt-1">{plan.subtitle}</p>

              <div className="text-4xl font-bold mt-6 mb-1">
                R$ {plan.price}<span className="text-lg text-gray-500 font-normal">/mês</span>
              </div>
              <p className="text-gray-400 text-xs mb-6">Por uma unidade. 50% para outras do mesmo cliente.</p>

              <ul className="space-y-3 text-sm text-gray-300 mb-8 flex-1">
                {plan.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-[#FF6600] shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>

              <a href="https://wa.me/5587988020504" target="_blank" rel="noopener noreferrer">
                <Button className={`w-full h-12 text-base font-medium ${
                  plan.highlight ? 'bg-[#FF6600] hover:bg-[#e55c00] text-white' : 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                }`}>
                  Falar com Consultor
                </Button>
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}