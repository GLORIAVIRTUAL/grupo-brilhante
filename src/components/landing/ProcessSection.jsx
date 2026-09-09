import React from 'react';

const steps = [
  ['01', 'Conte sua necessidade', 'Informe o serviço, a cidade e o tipo de operação.'],
  ['02', 'Alinhe os detalhes', 'Converse sobre a rotina, os requisitos e as condições de atendimento.'],
  ['03', 'Avalie a proposta', 'Receba as informações de escopo e condições comerciais para decidir o próximo passo.'],
];

export default function ProcessSection() {
  return <section className="process-section"><div className="section-heading"><p className="eyebrow">Como começamos</p><h2>Uma contratação começa entendendo sua operação.</h2><p>Antes de definir o serviço, precisamos conhecer seu espaço, seus horários e suas prioridades.</p></div><div className="process-grid">{steps.map(([number, title, text]) => <article key={number}><strong>{number}</strong><h3>{title}</h3><p>{text}</p></article>)}</div></section>;
}