import React from 'react';
import { motion } from 'framer-motion';

export default function SlideShell({ eyebrow, title, subtitle, children, footnote }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full max-w-6xl mx-auto px-6 md:px-10 py-10"
    >
      {eyebrow && (
        <span className="inline-block mb-4 px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-[#FF6600]/15 text-[#FF6600] border border-[#FF6600]/30">
          {eyebrow}
        </span>
      )}
      <h2 className="text-3xl md:text-5xl font-bold leading-tight text-white">{title}</h2>
      {subtitle && <p className="mt-4 text-base md:text-lg text-gray-300 max-w-3xl">{subtitle}</p>}
      {children && <div className="mt-8">{children}</div>}
      {footnote && <p className="mt-8 text-sm text-gray-400">{footnote}</p>}
    </motion.div>
  );
}