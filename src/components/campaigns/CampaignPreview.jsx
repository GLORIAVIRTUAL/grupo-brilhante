import React, { useRef } from 'react';
import html2canvas from 'html2canvas';
import { Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CampaignPreview({ imageUrl, overlayCopy }) {
  const previewRef = useRef(null);
  const copy = overlayCopy || {};

  const handleDownload = async () => {
    if (!previewRef.current) return;

    const canvas = await html2canvas(previewRef.current, {
      useCORS: true,
      backgroundColor: null,
      scale: 2
    });

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `campanha-final-${Date.now()}.png`;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div ref={previewRef} className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 aspect-[4/5]">
        <img src={imageUrl} alt="Campanha gerada" className="absolute inset-0 h-full w-full object-cover" crossOrigin="anonymous" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/80" />

        <div className="absolute inset-0 flex flex-col justify-between p-5 md:p-7">
          <div className="max-w-[78%] space-y-3">
            <div className="inline-flex w-fit rounded-full border border-white/20 bg-black/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white/90">
              {copy.eyebrow || '5àsec'}
            </div>

            {copy.headline && (
              <h2 className="text-3xl md:text-4xl font-bold leading-tight text-white drop-shadow-lg">
                {copy.headline}
              </h2>
            )}

            {copy.subheadline && (
              <p className="text-sm md:text-base leading-relaxed text-white/85 drop-shadow-md">
                {copy.subheadline}
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-white/15 bg-black/40 p-4 backdrop-blur-md md:p-5">
            {copy.highlight && (
              <div className="text-2xl font-bold text-[#FFB066] md:text-3xl">
                {copy.highlight}
              </div>
            )}

            {copy.cta && (
              <div className="mt-3 inline-flex rounded-full bg-[#FF6600] px-4 py-2 text-sm font-semibold text-white">
                {copy.cta}
              </div>
            )}

            {copy.disclaimer && (
              <p className="mt-3 text-xs text-white/65">
                {copy.disclaimer}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <a href={imageUrl} target="_blank" rel="noopener noreferrer">
          <Button variant="outline" className="gap-2 border-white/15 bg-transparent text-white hover:bg-white/10">
            <ExternalLink className="w-4 h-4" /> Abrir fundo
          </Button>
        </a>
        <Button onClick={handleDownload} className="gap-2 bg-[#4C12A1] text-white hover:bg-[#5b17bf]">
          <Download className="w-4 h-4" /> Baixar arte final
        </Button>
      </div>
    </div>
  );
}