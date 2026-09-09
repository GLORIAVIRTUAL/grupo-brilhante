import React from 'react';
import { Download } from 'lucide-react';

export default function DownloadButton({ label, url }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#FF6600] text-white font-semibold hover:bg-[#e65c00] transition-colors shadow-lg shadow-orange-900/30"
    >
      <Download className="w-4 h-4" />
      {label}
    </a>
  );
}