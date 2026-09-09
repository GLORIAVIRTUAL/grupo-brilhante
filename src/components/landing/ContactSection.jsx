import React from 'react';
import { Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import SocialLinks from '@/components/landing/SocialLinks';

export default function ContactSection({ whatsappUrl, image }) {
  return (
    <section className="contact-section" id="contato">
      <img src={image} alt="Profissional de higienização em ambiente hospitalar" />
      <div className="contact-copy"><p className="eyebrow">Contato comercial</p><h2>O que sua empresa precisa resolver hoje?</h2><p>Limpeza, higienização hospitalar, portaria, apoio operacional ou lavanderia hospitalar: conte sua necessidade.</p><a className="button button-primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={19} /> Pedir orçamento no WhatsApp</a><p className="contact-tip">Para agilizar, envie o nome da empresa, a cidade e o serviço desejado.</p><div className="contact-list"><a href="tel:+558738647950"><Phone size={18} />(87) 3864-7950</a><a href="tel:+558738643518"><Phone size={18} />(87) 3864-3518</a><a href="mailto:grupobrilhante@grupobrilhante.com.br"><Mail size={18} />grupobrilhante@grupobrilhante.com.br</a><p><MapPin size={18} />Rua Montreal, 81A, Loteamento Nova York, Petrolina — PE</p></div><SocialLinks variant="contact" /></div>
    </section>
  );
}