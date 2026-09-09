import React from 'react';
import { motion } from 'framer-motion';

export default function DryerMachine({ label = 'SECAR 1', code = 'DRY-7000' }) {
  return (
    <div className="relative flex flex-col items-center">
      {/* Holographic Container */}
      <div className="w-32 h-44 md:w-40 md:h-48 bg-white/5 backdrop-blur-md rounded-2xl border border-white/20 relative overflow-hidden flex flex-col shadow-[0_0_30px_rgba(168,85,247,0.3)]">
        {/* Header */}
        <div className="h-8 border-b border-white/10 bg-white/5 flex items-center px-3 justify-between">
          <span className="text-[9px] font-mono text-fuchsia-300">{code}</span>
          <div className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" />
        </div>

        {/* Drum Core */}
        <div className="flex-1 relative flex items-center justify-center">
          {/* Outer Ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className="w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-dashed border-fuchsia-400/30 absolute"
          />
          {/* Inner Heated Core */}
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-fuchsia-600/20 to-orange-400/20 backdrop-blur-sm border border-fuchsia-400/50 relative overflow-hidden shadow-inner">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
              className="w-full h-full absolute inset-0"
            >
              {/* Tumbling clothes */}
              <div className="absolute top-5 left-7 w-4 h-4 bg-white rounded-md shadow-[0_0_10px_white]" />
              <div className="absolute bottom-5 right-6 w-3 h-3 bg-orange-400 rounded-md shadow-[0_0_10px_#FF8800]" />
              <div className="absolute top-1/2 left-3 w-3 h-3 bg-fuchsia-300 rounded-md shadow-[0_0_10px_#e879f9]" />
            </motion.div>
          </div>

          {/* Heat glow pulse */}
          <motion.div
            animate={{ opacity: [0.2, 0.5, 0.2], scale: [1, 1.1, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-orange-500/10 blur-xl absolute"
          />
        </div>
      </div>

      {/* Base Platform */}
      <div className="w-40 md:w-48 h-4 bg-white/10 mt-2 rounded-full blur-md" />
      <div className="absolute -bottom-8 text-xs font-mono text-fuchsia-400 tracking-widest opacity-60 whitespace-nowrap">{label}</div>
    </div>
  );
}