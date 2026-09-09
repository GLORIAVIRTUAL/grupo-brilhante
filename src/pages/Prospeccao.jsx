import React from 'react';
import ProspectionManager from '@/components/settings/ProspectionManager';

export default function Prospeccao() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Prospecção</h1>
        <p className="mt-1 text-sm text-white/60">Encontre e aborde novos clientes potenciais.</p>
      </div>
      <ProspectionManager />
    </div>
  );
}