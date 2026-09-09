import React from 'react';
import { MessageCircle } from 'lucide-react';

export default function BrilavSection({ image, whatsappUrl }) {
  return (
    <section className="brilav-section" id="brilav">
      <div className="brilav-copy"><p className="eyebrow eyebrow-light">Brilav</p><h2>Lavanderia hospitalar para apoiar o cuidado com o enxoval da sua instituição.</h2><p>A rotina do enxoval precisa acompanhar a rotina do atendimento. A Brilav, integrante do Grupo Brilhante, atua no segmento de lavanderia hospitalar em Petrolina.</p><p>Informe o tipo de instituição, a cidade, as peças, o volume aproximado e a frequência desejada para iniciar a avaliação comercial.</p><a className="button button-light" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={19} /> Falar com a Brilav no WhatsApp</a></div>
      <img src={image} alt="Organização profissional de lençóis hospitalares limpos" />
    </section>
  );
}