import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function GroupSection({ image, whatsappUrl }) {
  return (
    <section className="split-section" id="grupo">
      <div className="split-media"><img src={image} alt="Atendimento profissional em recepção corporativa" /></div>
      <div className="split-copy"><p className="eyebrow">O Grupo Brilhante</p><h2>Um parceiro para os serviços que sustentam a rotina da sua empresa.</h2><p>Atuamos na prestação de serviços para empresas e instituições, reunindo frentes de limpeza, conservação, apoio operacional e lavanderia hospitalar.</p><p>Cada operação tem necessidades próprias. Por isso, o primeiro passo é entender o que precisa funcionar melhor na sua rotina.</p><ul><li><CheckCircle2 size={18} />Conservadora Brilhante</li><li><CheckCircle2 size={18} />Brilav — lavanderia hospitalar</li></ul><a className="button button-primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Apresentar minha necessidade</a></div>
    </section>
  );
}