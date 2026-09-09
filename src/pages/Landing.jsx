import React, { useEffect, useState } from 'react';
import { Sparkles, ShieldCheck, Shirt, Droplets, Leaf, MessageSquare, Clock, Truck } from 'lucide-react';
import LandingQuoteForm from '@/components/landing/LandingQuoteForm';
import './Landing.css';

const LOGO = 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/28c27e13c_Untitled110x40px.png';
const HERO_IMAGES = [
  { src: 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/81906a8b9_bag.png', alt: 'Bags 5àsec para cuidar das roupas de toda a família' },
  { src: 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/7e98f6ec3_L01_banner_960x545_5aSec.jpg', alt: 'Promoção 5àsec: você ganha de lavada' },
  { src: 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/41db71819_do-seu-jeito.jpg', alt: 'Planos 5àsec do seu jeito' },
];
const STORE = 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/0819c7ea4_padrao.jpg';
const INTERIOR = 'https://media.base44.com/images/public/6a99e42ee48200f5d8ddd176/8a97fb82d_images7.jpg';
const WHATSAPP = '5587988020504';

const services = [
  { icon: Sparkles, title: 'Revitalizar', desc: 'Retira roupas do ciclo de uso e devolve o aspecto de novo.' },
  { icon: ShieldCheck, title: 'Impermeabilizar', desc: 'Protege contra líquidos e sujeira do dia a dia.' },
  { icon: Shirt, title: 'Engomar', desc: 'Prolonga a vida da peça com acabamento profissional.' },
  { icon: Droplets, title: 'Bactericida', desc: 'Elimina ácaros e bactérias para mais higiene.' },
  { icon: Leaf, title: 'Branquear', desc: 'Tira manchas e devolve o branco das roupas claras.' },
];

export default function Landing() {
  const [heroImage, setHeroImage] = useState(0);
  const message = encodeURIComponent('Olá! Vim pelo site da Unidade Teste e gostaria de um orçamento de roupas.');

  useEffect(() => {
    const timer = window.setInterval(() => setHeroImage((current) => (current + 1) % HERO_IMAGES.length), 4500);
    return () => window.clearInterval(timer);
  }, []);
  const whatsappUrl = `https://wa.me/${WHATSAPP}?text=${message}`;

  return (
    <div className="landing-page">
      <header className="landing-header landing-wrap">
        <img className="landing-logo" src={LOGO} alt="5àsec · TEXTILE EXPERT" />
        <nav className="landing-nav" aria-label="Navegação principal">
          <a href="#servicos">Serviços</a><a href="#orcamento">Orçamento</a><a href="#unidade">A Unidade</a>
        </nav>
        <a className="landing-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a>
      </header>

      <main>
        <section className="landing-hero landing-wrap">
          <img key={heroImage} className="landing-hero-img landing-hero-img-slide" src={HERO_IMAGES[heroImage].src} alt={HERO_IMAGES[heroImage].alt} />
          <div className="landing-hero-copy">
            <p className="landing-eyebrow">5àsec · Textile Expert</p>
            <h1>Suas roupas merecem o melhor cuidado</h1>
            <p>Tratamento têxtil profissional para suas peças, com cuidado em cada detalhe.</p>
            <div className="landing-unit-summary"><strong>Unidade Teste</strong><span>Lavanderia, tratamento têxtil e delivery com coleta programada e controle total da peça do início ao fim.</span></div>
          </div>
        </section>

        <section id="servicos" className="landing-section">
          <div className="landing-wrap">
            <div className="landing-section-head"><div><h2>Serviços exclusivos 5àsec</h2><p className="landing-section-lead">Muito mais que lavanderia. Tratamento têxtil profissional.</p></div></div>
            <div className="landing-service-grid">
              {services.map(({ icon: Icon, title, desc }) => <article className="landing-service-card" key={title} tabIndex={0}><div className="landing-icon"><Icon /></div><h3>{title}</h3><p>{desc}</p></article>)}
            </div>
          </div>
        </section>

        <section id="orcamento" className="landing-section landing-quote">
          <div className="landing-wrap">
            <div className="landing-section-head"><div><h2>Peça seu orçamento</h2><p className="landing-section-lead">Escolha como prefere fazer. A gente cuida do resto.</p></div></div>
            <div className="landing-quote-grid">
              <div className="landing-panel"><h3>Orçamento detalhado</h3><p className="landing-panel-intro">Adicione suas peças com cor, tecido, avarias e observações.</p><LandingQuoteForm unitId={null} /></div>
              <div className="landing-panel landing-whatsapp-panel">
                <div><div className="landing-big-icon"><MessageSquare /></div><h3>Pelo WhatsApp</h3><p>Fale direto com a unidade e receba o orçamento no seu zap.</p></div>
                <div><a className="landing-wa-large" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a><div className="landing-benefits"><div className="landing-benefit"><Clock />Pronto em 24h</div><div className="landing-benefit"><Truck />Coleta e entrega</div></div></div>
              </div>
            </div>
          </div>
        </section>

        <section id="unidade" className="landing-section landing-unit-section">
          <div className="landing-wrap landing-unit-grid">
            <img className="landing-store" src={STORE} alt="Fachada Unidade Teste 5àsec" />
            <div className="landing-unit-text"><h2>Traga suas roupas para a líder mundial em lavanderias</h2><p>A Unidade Teste 5àsec oferece lavanderia, tratamento têxtil e delivery com coleta programada e controle total da peça do início ao fim.</p><img className="landing-interior" src={INTERIOR} alt="Interior Unidade Teste 5àsec" /></div>
          </div>
        </section>

        <section className="landing-cta"><div className="landing-wrap"><h2>Pronto para suas roupas ficarem como novas?</h2><p>Peça seu orçamento agora mesmo.</p><a href="#orcamento">Fazer orçamento</a></div></section>
      </main>

      <footer className="landing-footer"><div className="landing-wrap landing-footer-inner"><img src={LOGO} alt="5àsec · TEXTILE EXPERT" /><p>© 2026 5àsec Unidade Teste · TEXTILE EXPERT</p></div></footer>
    </div>
  );
}