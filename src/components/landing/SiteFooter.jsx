import React from 'react';

export default function SiteFooter({ logo }) {
  return <footer className="site-footer"><img src={logo} alt="Grupo Brilhante" /><p>Limpeza, terceirização e lavanderia hospitalar para empresas e instituições.</p><p>© {new Date().getFullYear()} Grupo Brilhante.</p></footer>;
}