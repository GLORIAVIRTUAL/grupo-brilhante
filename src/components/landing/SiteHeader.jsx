import React from 'react';
import { MessageCircle } from 'lucide-react';

export default function SiteHeader({ logo, whatsappUrl }) {
  return (
    <header className="site-header">
      <a href="#inicio" aria-label="Grupo Brilhante — início"><img src={logo} alt="Grupo Brilhante" /></a>
      <nav aria-label="Navegação principal">
        <a href="#servicos">Serviços</a><a href="#grupo">O Grupo</a><a href="#brilav">Brilav</a><a href="#contato">Contato</a>
      </nav>
      <a className="button button-header" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
        <MessageCircle size={18} /> <span>Pedir orçamento no WhatsApp</span>
      </a>
    </header>
  );
}