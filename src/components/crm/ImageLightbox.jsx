import React from 'react';
import { X } from 'lucide-react';

export default function ImageLightbox({ url, onClose }) {
  if (!url) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
        aria-label="Fechar imagem"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={url}
        alt="Imagem ampliada"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
    </div>
  );
}