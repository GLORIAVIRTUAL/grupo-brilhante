import React from 'react';
import { ArrowDownRight, MessageCircle } from 'lucide-react';

export default function HeroSection({ image, whatsappUrl }) {
  return (
    <section className="site-hero" id="inicio">
      <div className="hero-copy">
        <p className="eyebrow">Serviços para empresas e instituições</p>
        <h1>Limpeza, equipes de apoio e lavanderia hospitalar para sua empresa funcionar melhor.</h1>
        <p className="hero-lead">O Grupo Brilhante reúne soluções de limpeza, conservação, portaria, terceirização de profissionais e lavanderia hospitalar.</p>
        <p>Conte o que sua empresa precisa e converse com nossa equipe sobre uma proposta para sua operação.</p>
        <div className="hero-actions">
          <a className="button button-primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={19} /> Pedir orçamento no WhatsApp</a>
          <a className="button button-link" href="#servicos">Conhecer os serviços <ArrowDownRight size={18} /></a>
        </div>
      </div>
      <figure className="hero-media"><img src={image} alt="Profissional realizando limpeza em ambiente corporativo" /><figcaption>Soluções planejadas para a rotina da sua operação.</figcaption></figure>
    </section>
  );
}