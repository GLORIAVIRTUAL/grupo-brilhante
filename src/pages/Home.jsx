import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Home() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redundant check, handled in Layout usually, but safe to keep
    const hostname = window.location.hostname;
    const isMainDomain = hostname === 'chat5asec.com.br' || hostname === 'www.chat5asec.com.br';

    if (isMainDomain) {
      navigate('/landing');
    } else {
      navigate('/dashboard');
    }
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-[#1a0b36]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#FF6600]"></div>
        <p className="text-white/50 text-sm">Carregando...</p>
      </div>
    </div>
  );
}