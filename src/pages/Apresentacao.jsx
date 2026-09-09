import React, { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { slides } from '@/lib/presentationSlides';
import SlideShell from '@/components/presentation/SlideShell';
import { BulletList, PlansGrid, StatsGrid } from '@/components/presentation/SlideBody';
import DownloadButton from '@/components/presentation/DownloadButton';
import ClosingManifesto from '@/components/presentation/ClosingManifesto';

export default function Apresentacao() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];

  const go = useCallback((delta) => {
    setIndex((prev) => Math.min(slides.length - 1, Math.max(0, prev + delta)));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  return (
    <div className="min-h-screen bg-[#1a0b36] text-white relative overflow-hidden flex flex-col">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#4C12A1] blur-[150px] opacity-40 pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[#FF6600] blur-[150px] opacity-20 pointer-events-none" />

      <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/10">
        <img
          src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6998e8554cc6b3863e37588a/deb6f92a5_Untitleddesign51.png"
          alt="CHAT5àsec"
          className="h-10 w-auto object-contain"
        />
        <div className="flex items-center gap-5">
          <a href="https://gloriavirtual.com/" target="_blank" rel="noopener noreferrer" title="gloriavirtual.com">
            <img
              src="https://media.base44.com/images/public/6998e8554cc6b3863e37588a/8c3e497aa_Marca.png"
              alt="Glória"
              className="h-8 w-auto object-contain hover:opacity-80 transition-opacity"
            />
          </a>
          <span className="text-sm text-gray-400">
            {index + 1} / {slides.length}
          </span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center">
        <SlideShell
          key={index}
          eyebrow={slide.eyebrow}
          title={slide.title}
          subtitle={slide.subtitle}
          footnote={slide.footnote}
        >
          {slide.image && (
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-purple-900/40">
              <img src={slide.image} alt="" className="w-full h-[280px] md:h-[380px] object-cover" />
            </div>
          )}
          {slide.stats && <StatsGrid stats={slide.stats} />}
          {slide.plans && <PlansGrid plans={slide.plans} extra={slide.extra} discount={slide.discount} />}
          {slide.manifesto && <ClosingManifesto lines={slide.manifesto} signature={slide.signature} />}
          {slide.bullets && <BulletList bullets={slide.bullets} advantage={slide.advantage} />}
          {slide.download && (
            <div className="pt-6">
              <DownloadButton label={slide.download.label} url={slide.download.url} />
            </div>
          )}
        </SlideShell>
      </main>

      <footer className="relative z-10 px-6 md:px-10 py-5 border-t border-white/10 flex items-center justify-between gap-4">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" /> Anterior
        </button>

        <div className="flex items-center gap-2 flex-wrap justify-center">
          {slides.map((s, i) => (
            <button
              key={s.title}
              onClick={() => setIndex(i)}
              aria-label={`Ir para o slide ${i + 1}`}
              className={`h-2.5 rounded-full transition-all ${i === index ? 'w-8 bg-[#FF6600]' : 'w-2.5 bg-white/25 hover:bg-white/50'}`}
            />
          ))}
        </div>

        <button
          onClick={() => go(1)}
          disabled={index === slides.length - 1}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF6600] text-white font-semibold hover:bg-[#e65c00] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Próximo <ChevronRight className="w-4 h-4" />
        </button>
      </footer>
    </div>
  );
}