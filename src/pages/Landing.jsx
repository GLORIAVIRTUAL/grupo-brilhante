import React, { useState } from 'react';
import { MessageSquare, PhoneCall, Play, CheckCircle2, ShieldCheck, Factory, Building2, Hotel, Hospital, UtensilsCrossed, Sparkles } from 'lucide-react';
import './Landing.css';

const LOGO = 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/10365075e_Untitled110x40px1.png';
const HERO_IMG = 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/58b0deae5_generated_c586e167.jpg';
const VIDEO_THUMB = 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/e88d01ccc_generated_d4119c85.jpg';
const WHATSAPP_NUM = '5587988020504';

const SOLUTIONS = [
  { icon: ShieldCheck, title: 'Uniformes', desc: 'Cuidado profissional para a apresentação, higiene e máxima durabilidade dos uniformes das suas equipes.' },
  { icon: Hotel, title: 'Hotelaria', desc: 'Processamento consistente e pontual para enxovais, lençóis e operações de hospitalidade com alto padrão.' },
  { icon: Hospital, title: 'Hospitalar', desc: 'Tratamento têxtil com rigor sanitário, barreiras bacteriológicas e controle para ambientes de saúde.' },
  { icon: Factory, title: 'Indústrias', desc: 'Fluxos sob medida para rotinas industriais contínuas de alta demanda e grandes volumes diários.' },
  { icon: UtensilsCrossed, title: 'Frigoríficos', desc: 'Higienização e desinfecção especializada para linhas de produção de alimentos e frigoríficos.' },
  { icon: Sparkles, title: 'Linha Pesada', desc: 'Estrutura mecânica preparada para peças robustas, EPIs e grandes volumes de lavagem pesada.' },
];

const CLIENTS = [
  { name: 'Redes Hoteleiras & Resorts', category: 'Hotelaria e Turismo' },
  { name: 'Complexos Hospitalares & Clínicas', category: 'Saúde e Higiene' },
  { name: 'Indústrias Metalúrgicas & Automotivas', category: 'Indústria Pesada' },
  { name: 'Frigoríficos & Agroindústrias', category: 'Processamento de Alimentos' },
  { name: 'Grandes Redes de Restaurantes & Gastronomia', category: 'Alimentação Corporativa' },
  { name: 'Empresas de Facilities & Terceirização', category: 'Serviços Corporativos' },
];

export default function Landing() {
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);

  const whatsappMessage = encodeURIComponent(
    'Olá! Sou representante de uma empresa e gostaria de solicitar uma proposta comercial corporativa de lavanderia industrial com o Grupo Brilhante.'
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_NUM}?text=${whatsappMessage}`;

  return (
    <div className="gb-page">
      {/* 1. Header com barra branca e logo original */}
      <header className="gb-header">
        <a href="/">
          <img className="gb-logo" src={LOGO} alt="BRILHANTE · LIMPEZA & TERCEIRIZAÇÃO" />
        </a>
        <nav className="gb-nav" aria-label="Navegação Corporativa">
          <a href="#historia">Nossa História</a>
          <a href="#estrutura">Estrutura e Tecnologia</a>
          <a href="#solucoes">Soluções B2B</a>
          <a href="#clientes">Clientes</a>
        </nav>
        <a className="gb-contact" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
          <MessageSquare className="w-4 h-4" />
          WhatsApp Comercial
        </a>
      </header>

      <main className="gb-main">
        {/* 2. Hero B2B Industrial */}
        <section className="gb-hero">
          <div className="gb-hero-copy">
            <p className="gb-kicker">Lavanderia Industrial & Gestão Têxtil</p>
            <h1>Excelência têxtil para operações que não podem parar</h1>
            <p>
              Tratamento profissional de lavanderia industrial para indústrias, hospitais, hotéis e grandes corporações.
              Escala, rastreabilidade e pontualidade com a solidez de quem atua há mais de 30 anos.
            </p>
            <div className="gb-hero-actions">
              <a className="gb-primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                Fale com o comercial
              </a>
              <a className="gb-secondary" href="#solucoes">
                Conheça nossas soluções
              </a>
            </div>
          </div>

          <div className="gb-hero-visual">
            <img className="gb-hero-img" src={HERO_IMG} alt="Estrutura e tecnologia operacional Grupo Brilhante" />
            <div className="gb-float one">
              <strong>+30</strong>
              <span>Anos de solidez de mercado</span>
            </div>
            <div className="gb-float two">
              <strong>+50k kg/dia</strong>
              <span>Capacidade operacional instalada</span>
            </div>
          </div>
        </section>

        {/* 3. Indicadores de Impacto */}
        <section className="gb-stats">
          <div className="gb-stat">
            <strong>+30 Anos</strong>
            <span>Credibilidade e liderança em terceirização e gestão têxtil</span>
          </div>
          <div className="gb-stat">
            <strong>+50.000 kg/dia</strong>
            <span>Capacidade operacional para atender grandes demandas</span>
          </div>
          <div className="gb-stat">
            <strong>+120 Clientes</strong>
            <span>Empresas atendidas com contratos contínuos de SLA</span>
          </div>
        </section>

        {/* 4. Nossa História (30+ Anos) */}
        <section className="gb-section white" id="historia">
          <div className="gb-section-wrap">
            <div className="gb-history">
              <div>
                <div className="gb-rule"></div>
                <h2>Nossa História</h2>
                <p className="gb-lead">Mais de 30 anos construindo confiança e excelência operacional</p>
                <p style={{ marginTop: '16px' }}>
                  Fundado com o compromisso de entregar o mais alto padrão em serviços terceirizados e cuidados têxteis,
                  o Grupo Brilhante consolidou-se como um parceiro estratégico para o setor produtivo.
                  Com infraestrutura de ponta, processos certificados e equipe treinada, garantimos abastecimento constante
                  para que a sua empresa foque exclusivamente no seu core business.
                </p>
              </div>
              <div className="gb-timeline">
                <div>
                  <strong>30+</strong>
                  <span>anos de experiência e credibilidade sólida</span>
                </div>
                <div>
                  <strong>100%</strong>
                  <span>conformidade com normas sanitárias e ambientais</span>
                </div>
                <div>
                  <strong>SLA</strong>
                  <span>coleta e entrega programada rigorosamente</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 5. Estrutura e Tecnologia Operacional */}
        <section className="gb-section" id="estrutura">
          <div className="gb-tech">
            <img className="gb-image" src={HERO_IMG} alt="Estrutura e Tecnologia Operacional" />
            <div className="gb-tech-copy">
              <div className="gb-rule"></div>
              <h2>Estrutura e Tecnologia Operacional</h2>
              <p className="gb-lead">Processos automatizados com máquinas industriais de última geração.</p>
              <ul className="gb-list">
                <li>Controle total da peça do início ao fim</li>
                <li>Rastreabilidade e relatórios por lote</li>
                <li>Tratamento térmico e químico balanceado</li>
                <li>Logística própria para coleta e entrega pontual</li>
              </ul>
            </div>
          </div>
        </section>

        {/* 6. Soluções B2B */}
        <section className="gb-section white" id="solucoes">
          <div className="gb-section-wrap">
            <div className="gb-section-head">
              <div>
                <div className="gb-rule"></div>
                <h2>Soluções B2B Corporativas</h2>
                <p className="gb-lead">Serviços técnicos e personalizados para cada segmento produtivo.</p>
              </div>
            </div>
            <div className="gb-solutions">
              {SOLUTIONS.map((sol, index) => {
                const Icon = sol.icon;
                return (
                  <article className="gb-card" key={index}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(33,111,161,0.12)', color: '#216FA1', display: 'grid', placeItems: 'center' }}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 style={{ margin: 0 }}>{sol.title}</h3>
                    </div>
                    <p>{sol.desc}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* 7. Clientes Corporativos */}
        <section className="gb-section" id="clientes">
          <div className="gb-section-head">
            <div>
              <div className="gb-rule"></div>
              <h2>Clientes & Segmentos Atendidos</h2>
              <p className="gb-lead">Parceiros que confiam sua operação diária ao Grupo Brilhante.</p>
            </div>
          </div>
          <div className="gb-clients">
            {CLIENTS.map((client, idx) => (
              <div className="gb-client" key={idx}>
                <div className="gb-client-icon">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <div style={{ color: '#17364F', fontWeight: 700 }}>{client.name}</div>
                  <div style={{ fontSize: '12px', color: '#637989', marginTop: '2px' }}>{client.category}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 8. Vídeo Institucional */}
        <section className="gb-video-section">
          <div className="gb-video">
            <div>
              <div className="gb-rule" style={{ background: '#54A8DC' }}></div>
              <h2>Vídeo Institucional</h2>
              <p className="gb-lead">
                Conheça de perto a nossa estrutura, nossos equipamentos de alta tecnologia e o cuidado minucioso
                por trás de cada atendimento empresarial.
              </p>
              <div style={{ marginTop: '28px' }}>
                <a className="gb-primary" style={{ background: '#216FA1' }} href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                  Agende uma visita técnica à fábrica
                </a>
              </div>
            </div>
            <figure>
              {isPlayingVideo ? (
                <video controls autoPlay src="https://assets.mixkit.co/videos/preview/mixkit-modern-factory-production-line-42994-large.mp4">
                  Seu navegador não suporta a tag de vídeo.
                </video>
              ) : (
                <>
                  <img src={VIDEO_THUMB} alt="Vídeo Institucional Grupo Brilhante" />
                  <button className="gb-play" onClick={() => setIsPlayingVideo(true)} aria-label="Reproduzir Vídeo Institucional">
                    <Play className="w-6 h-6 fill-current" />
                  </button>
                </>
              )}
            </figure>
          </div>
        </section>

        {/* 9. CTA WhatsApp Corporativo */}
        <div className="gb-cta-wrapper" style={{ marginTop: '90px' }}>
          <section className="gb-cta">
            <div>
              <h2>Pronto para elevar o padrão da sua operação têxtil?</h2>
              <p>Fale diretamente com nossa diretoria comercial pelo WhatsApp e solicite um estudo de viabilidade sem compromisso.</p>
            </div>
            <a className="gb-wa" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageSquare className="w-5 h-5 text-emerald-700" />
              Solicitar Contato Comercial
            </a>
          </section>
        </div>
      </main>

      {/* 10. Rodapé Institucional com Redes Sociais */}
      <footer className="gb-footer">
        <div>
          <img src={LOGO} alt="BRILHANTE · LIMPEZA & TERCEIRIZAÇÃO" />
          <p style={{ marginTop: '10px' }}>© {new Date().getFullYear()} Grupo Brilhante · Mais de 30 anos de solidez e excelência.</p>
        </div>
        <div className="gb-social">
          <a href="https://facebook.com" target="_blank" rel="noopener noreferrer">Facebook</a>
          <a href="https://instagram.com" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </div>
      </footer>
    </div>
  );
}