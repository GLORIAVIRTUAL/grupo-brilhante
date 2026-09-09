import React from 'react';
import { motion } from 'framer-motion';
import {
  Image as ImageIcon,
  Video,
  CalendarClock,
  Megaphone,
  Search,
  BarChart3,
  PauseCircle,
  Sparkles
} from 'lucide-react';

const cards = [
  {
    icon: ImageIcon,
    title: 'Designs prontos para postar',
    desc: 'Crie artes completas com texto, marca, imagem e legenda — e poste direto na rede social da unidade sem sair do sistema.'
  },
  {
    icon: Video,
    title: 'Vídeos a partir da arte',
    desc: 'Transforme a imagem criada em vídeo e publique também nas redes sociais da unidade com um clique.'
  },
  {
    icon: CalendarClock,
    title: 'Agenda de postagens',
    desc: 'Importe as artes e textos enviados pela franqueadora e programe os dias e horários de publicação.'
  },
  {
    icon: Megaphone,
    title: 'Tráfego pago Meta sem gestor',
    desc: 'Descreva a campanha e a IA monta toda a estratégia. Importe imagem ou vídeo, defina a verba e ela é programada no gerenciador de anúncios da unidade.'
  },
  {
    icon: Search,
    title: 'Google Ads automático',
    desc: 'A IA gera palavras-chave, headlines e descriptions e sobe a campanha de Pesquisa. Também cria Display, Performance Max e vídeo no YouTube.'
  },
  {
    icon: BarChart3,
    title: 'Resultados e controle total',
    desc: 'Acompanhe a performance e o uso da verba no Meta e no Google Ads, pause campanhas e crie quantas quiser — tudo dentro do sistema.'
  }
];

export default function MarketingSection() {
  return (
    <section id="marketing" className="py-24 bg-gradient-to-b from-[#1a0b36] to-[#0f0622] relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[700px] bg-[#FF6600]/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-[#FF6600]/15 border border-[#FF6600]/30 rounded-full px-4 py-1.5 mb-5">
            <Sparkles className="w-4 h-4 text-[#FF6600]" />
            <span className="text-xs font-bold uppercase tracking-wider text-[#FF6600]">A maior novidade</span>
          </div>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white">
            Uma agência de marketing <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF6600] to-orange-400">dentro do sistema</span>
          </h2>
          <p className="text-gray-300 mt-5 max-w-3xl mx-auto text-lg">
            Algo que nenhum outro sistema no mundo tem: o franqueado não precisa mais contratar agência de marketing nem gestor de tráfego. Está tudo aqui.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.08 }}
              className="bg-white/5 backdrop-blur-sm p-7 rounded-2xl border border-white/10 hover:border-[#FF6600]/40 transition-colors"
            >
              <div className="w-12 h-12 bg-[#FF6600]/15 rounded-xl flex items-center justify-center mb-5">
                <card.icon className="w-6 h-6 text-[#FF6600]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">{card.title}</h3>
              <p className="text-gray-400 leading-relaxed text-sm">{card.desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="mt-12 flex items-center justify-center gap-3 text-gray-300 text-sm">
          <PauseCircle className="w-5 h-5 text-[#FF6600]" />
          <span>Crie, pause e gerencie quantas campanhas quiser, sem custos extras de agência.</span>
        </div>
      </div>
    </section>
  );
}