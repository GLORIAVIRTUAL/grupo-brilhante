import React from 'react';
import './Landing.css';
import SiteHeader from '@/components/landing/SiteHeader';
import HeroSection from '@/components/landing/HeroSection';
import ServicesSection from '@/components/landing/ServicesSection';
import ProcessSection from '@/components/landing/ProcessSection';
import GroupSection from '@/components/landing/GroupSection';
import StructureGallery from '@/components/landing/StructureGallery';
import BrilavSection from '@/components/landing/BrilavSection';
import FaqSection from '@/components/landing/FaqSection';
import ContactSection from '@/components/landing/ContactSection';
import B2BLeadForm from '@/components/landing/B2BLeadForm';
import SiteFooter from '@/components/landing/SiteFooter';

const LOGO = 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/ebd27cafa_marcabrilhante.png';
const IMAGES = {
  cleaning: 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/b2b017597_Limpezaprofissionalemlobbycorporativo.png',
  laundry: 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/85fd151fb_Organizaoprofissionaldelenishospitalareslimpos.png',
  reception: 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/7c73e007a_Recepocorporativacomacolhimentoprofissional.png',
  hospital: 'https://media.base44.com/images/public/6aa0eab298ecefdbd48dda38/3623fa19d_Limpezahospitalarcomcuidadoepreciso.png',
};
const WHATSAPP_NUMBER = '5587988020504';
const message = 'Olá! Conheci o Grupo Brilhante pelo site e gostaria de solicitar um orçamento para minha empresa.';
const buildWhatsappUrl = (subject = '') => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(subject ? `${message} Tenho interesse em: ${subject}.` : message)}`;

export default function Landing() {
  const whatsappUrl = buildWhatsappUrl();
  return <div className="site-page"><SiteHeader logo={LOGO} whatsappUrl={whatsappUrl} /><main><HeroSection image={IMAGES.cleaning} whatsappUrl={whatsappUrl} /><ServicesSection buildWhatsappUrl={buildWhatsappUrl} /><ProcessSection /><GroupSection image={IMAGES.reception} whatsappUrl={whatsappUrl} /><StructureGallery /><BrilavSection image={IMAGES.laundry} whatsappUrl={buildWhatsappUrl('Brilav — lavanderia hospitalar')} /><FaqSection /><ContactSection image={IMAGES.hospital} whatsappUrl={buildWhatsappUrl('contato comercial')} /><section id="diagnostico" className="lead-section"><div className="lead-copy"><p className="eyebrow">Diagnóstico empresarial</p><h2>Conte como funciona sua operação.</h2><p>Informe o segmento, o serviço e o volume aproximado. A solicitação entra no funil B2B com origem e consentimento rastreáveis; nenhuma cobrança ou compromisso contratual é criado automaticamente.</p></div><div className="lead-form-card"><B2BLeadForm /></div></section></main><SiteFooter logo={LOGO} /></div>;
}