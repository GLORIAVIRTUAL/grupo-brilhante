import React from 'react';

const faqs = [
  ['Como peço um orçamento?', 'Clique no botão de WhatsApp e informe sua empresa, cidade e serviço de interesse.'],
  ['Vocês atendem minha cidade?', 'Envie a cidade e o endereço aproximado. A equipe confirma a disponibilidade para o serviço solicitado.'],
  ['O que preciso informar para cotar limpeza?', 'Tipo de espaço, área aproximada, horários de funcionamento e frequência desejada.'],
  ['Materiais e equipamentos entram na contratação?', 'A composição depende do escopo. Alinhe com a equipe o que estará previsto na proposta.'],
  ['Como solicitar lavanderia hospitalar?', 'Informe o tipo de instituição, cidade, peças e volume estimado de enxoval.'],
];

export default function FaqSection() {
  return <section className="content-section faq-section"><div className="section-heading"><p className="eyebrow">Dúvidas frequentes</p><h2>Informações para começar.</h2></div><div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>;
}