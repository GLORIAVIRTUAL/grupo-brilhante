import React from 'react';

const photos = [
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/03/O-GRUPO-1500x700.jpg', 'Acervo institucional do Grupo Brilhante'],
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/03/conservadora-brilhante-1500x700.jpg', 'Estrutura da Conservadora Brilhante'],
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/02/portaria-500x400.jpg', 'Equipe de portaria do acervo histórico'],
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/02/Higieniza%C3%A7%C3%A3o-e-limpeza-de-hospitais-500x400.jpg', 'Operação de higienização hospitalar'],
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/03/Brilav_01_06_17-500x400.jpg', 'Estrutura original da Brilav'],
  ['https://grupobrilhante.com.br/wp-content/uploads/2018/03/Brilav_01_06_17-12-500x400.jpg', 'Equipamentos da lavanderia hospitalar'],
];

function Photo({ item, hidden = false }) {
  return <figure className="archive-photo" aria-hidden={hidden || undefined}><img src={item[0]} alt={hidden ? '' : item[1]} /><figcaption>{item[1]}</figcaption></figure>;
}

export default function StructureGallery() {
  return <section className="archive-section" id="estrutura"><div className="archive-heading"><p className="eyebrow">Estrutura original</p><h2>Uma trajetória construída em operação.</h2><p>Registros do acervo do antigo site preservam parte da história da Conservadora Brilhante e da Brilav.</p></div><div className="archive-window"><div className="archive-track">{photos.map((item) => <Photo item={item} key={item[0]} />)}{photos.map((item) => <Photo item={item} hidden key={`copy-${item[0]}`} />)}</div></div></section>;
}