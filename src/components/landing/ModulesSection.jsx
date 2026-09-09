import React from 'react';
import { motion } from 'framer-motion';
import {
  Truck,
  Route,
  Star,
  RefreshCw,
  Banknote,
  Receipt,
  Send,
  Gift,
  Megaphone,
  Image as ImageIcon,
  Video,
  CalendarClock,
  Search,
  BarChart3,
  Sparkles,
  PauseCircle
} from 'lucide-react';

const modules = [
  {
    tag: 'Coletas & Rotas',
    color: 'from-blue-500 to-cyan-500',
    icon: Truck,
    title: 'Agendamento e rotas inteligentes',
    desc: 'Agende coletas automáticas e manuais. O sistema monta as melhores rotas de entrega do dia conforme os endereços dos clientes.',
    features: [
      { icon: Route, text: 'Melhor rota do dia por endereço' },
      { icon: Star, text: 'Coletas prioritárias' },
      { icon: RefreshCw, text: 'Coletas recorrentes e encaixes' }
    ]
  },
  {
    tag: 'Gestão & Financeiro',
    color: 'from-emerald-500 to-green-500',
    icon: Banknote,
    title: 'Processos e financeiro completos',
    desc: 'Controle total de processos da lavanderia e do financeiro: entradas, saídas e geração de tickets em um só lugar.',
    features: [
      { icon: Banknote, text: 'Entradas e saídas (fluxo de caixa)' },
      { icon: Receipt, text: 'Geração de tickets de serviço' },
      { icon: BarChart3, text: 'Visão de lucro por unidade' }
    ]
  },
  {
    tag: 'Disparos Inteligentes',
    color: 'from-pink-500 to-rose-500',
    icon: Send,
    title: 'Disparos automáticos e manuais',
    desc: 'Recupere clientes que sumiram, parabenize aniversariantes, envie promoções e pesquisas de satisfação — e meça o retorno.',
    features: [
      { icon: Gift, text: 'Aniversário, recuperação e promoções' },
      { icon: CalendarClock, text: 'Manuais ou pré-programados' },
      { icon: BarChart3, text: 'Relatório de retorno dos disparos' }
    ]
  }
];

export default function ModulesSection() {
  return (
    <section id="modulos" className="py-24 bg-[#1a0b36] relative">
      <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-[#1a0b36] pointer-events-none" />
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center mb-16">
          <span className="text-[#FF6600] uppercase tracking-widest text-xs font-bold">Plataforma completa</span>
          <h2 className="text-3xl md:text-4xl font-bold text-white mt-3">Muito mais que atendimento</h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto">
            Um sistema único que cuida do atendimento, das coletas, do financeiro, dos disparos e do marketing da sua unidade.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {modules.map((mod, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
              className="bg-white/5 p-8 rounded-2xl border border-white/10 hover:border-[#FF6600]/30 transition-colors"
            >
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${mod.color} flex items-center justify-center mb-5`}>
                <mod.icon className="w-6 h-6 text-white" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">{mod.tag}</span>
              <h3 className="text-xl font-bold text-white mt-2 mb-3">{mod.title}</h3>
              <p className="text-gray-400 leading-relaxed mb-6">{mod.desc}</p>
              <ul className="space-y-3">
                {mod.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-gray-300">
                    <f.icon className="w-4 h-4 text-[#FF6600] shrink-0" />
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}