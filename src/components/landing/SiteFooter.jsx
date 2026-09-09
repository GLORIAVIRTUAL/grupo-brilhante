import React from 'react';
import SocialLinks from '@/components/landing/SocialLinks';

export default function SiteFooter({ logo }) {
  return (
    <footer className="site-footer">
      <img src={logo} alt="Grupo Brilhante" />
      <p>Limpeza, terceirização e lavanderia hospitalar para empresas e instituições.</p>
      <SocialLinks variant="footer" />
      <p>© {new Date().getFullYear()} Grupo Brilhante.</p>
    </footer>
  );
}