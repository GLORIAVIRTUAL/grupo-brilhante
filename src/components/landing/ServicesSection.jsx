import React from 'react';
import { Building2, HeartPulse, Shirt, UserRoundCheck } from 'lucide-react';

const services = [
  { icon: Building2, title: 'Limpeza e conservação', text: 'Rotinas de limpeza recorrente alinhadas ao tipo de espaço, fluxo de pessoas, horários e frequência da sua empresa.', cta: 'Quero um orçamento de limpeza' },
  { icon: HeartPulse, title: 'Higienização hospitalar', text: 'Avaliação do escopo de limpeza conforme os ambientes, turnos e requisitos internos de instituições de saúde.', cta: 'Falar sobre higienização hospitalar' },
  { icon: UserRoundCheck, title: 'Portaria e apoio operacional', text: 'Profissionais para postos e atividades de apoio, definidos conforme funções, horários, local e rotina da operação.', cta: 'Solicitar proposta de terceirização' },
  { icon: Shirt, title: 'Brilav — Lavanderia hospitalar', text: 'Solução para instituições que buscam atendimento comercial para o processamento do seu enxoval hospitalar.', cta: 'Pedir orçamento para meu enxoval' },
];

export default function ServicesSection({ buildWhatsappUrl }) {
  return <section className="content-section" id="servicos"><div className="section-heading"><p className="eyebrow">Nossas frentes de atendimento</p><h2>Qual serviço sua empresa procura?</h2><p>Escolha uma frente para iniciar uma conversa direcionada com nossa equipe.</p></div><div className="service-grid">{services.map(({ icon: Icon, title, text, cta }) => <article className="service-card" key={title}><span className="icon-box"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p><a href={buildWhatsappUrl(title)} target="_blank" rel="noopener noreferrer">{cta} <span aria-hidden="true">→</span></a></article>)}</div></section>;
}