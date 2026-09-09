import React from 'react';
import { motion } from 'framer-motion';

export default function DryCleanMachine({ label = 'LAVAGEM SECO 1', code = 'DRC-5000' }) {
  return (
    <div className="relative flex flex-col items-center">
      {/* Holographic Container */}
      <div className="w-32 h-44 md:w-40 md:h-48 bg-white/5 backdrop-blur-md rounded-2xl border border-white/20 relative overflow-hidden flex flex-col shadow-[0_0_30px_rgba(16,185,129,0.3)]">
        {/* Header */}
        <div className="h-8 border-b border-white/10 bg-white/5 flex items-center px-3 justify-between">
          <span className="text-[9px] font-mono text-emerald-300">{code}</span>
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>

        {/* Chamber Core */}
        <div className="flex-1 relative flex items-center justify-center">
          {/* Hexagonal frame */}
          <div className="w-24 h-24 md:w-28 md:h-28 rounded-2xl border border-emerald-400/30 absolute" />

          {/* Solvent vapor swirl */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
            className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-emerald-600/20 to-teal-400/20 backdrop-blur-sm border border-emerald-400/50 relative overflow-hidden shadow-inner"
          >
            {/* Vapor bubbles */}
            <div className="absolute top-5 left-6 w-3 h-3 bg-white/70 rounded-full shadow-[0_0_10px_white]" />
            <div className="absolute bottom-6 right-7 w-2.5 h-2.5 bg-emerald-200 rounded-full shadow-[0_0_8px_#a7f3d0]" />
            <div className="absolute top-1/2 right-4 w-2 h-2 bg-teal-200 rounded-full shadow-[0_0_8px_#99f6e4]" />
          </motion.div>

          {/* Rising vapor */}
          <motion.div
            animate={{ opacity: [0, 0.6, 0], y: -25, scale: 1.4 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute bottom-8 w-10 h-10 bg-emerald-300/20 rounded-full blur-lg"
          />
        </div>
      </div>

      {/* Base Platform */}
      <div className="w-40 md:w-48 h-4 bg-white/10 mt-2 rounded-full blur-md" />
      <div className="absolute -bottom-8 text-xs font-mono text-emerald-400 tracking-widest opacity-60 whitespace-nowrap">{label}</div>
    </div>
  );
}