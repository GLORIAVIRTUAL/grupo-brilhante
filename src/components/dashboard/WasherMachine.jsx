import React from 'react';
import { motion } from 'framer-motion';

export default function WasherMachine({ label = 'LAVAR 1', code = 'WSH-9000' }) {
  return (
    <div className="relative flex flex-col items-center">
      {/* Holographic Container */}
      <div className="w-32 h-44 md:w-40 md:h-48 bg-white/5 backdrop-blur-md rounded-2xl border border-white/20 relative overflow-hidden flex flex-col shadow-[0_0_30px_rgba(76,18,161,0.3)]">
        {/* Header */}
        <div className="h-8 border-b border-white/10 bg-white/5 flex items-center px-3 justify-between">
          <div className="flex gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <div className="w-2 h-2 rounded-full bg-yellow-500/50" />
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <span className="text-[9px] font-mono text-blue-300">{code}</span>
        </div>

        {/* Drum Core */}
        <div className="flex-1 relative flex items-center justify-center">
          {/* Outer Ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            className="w-24 h-24 md:w-28 md:h-28 rounded-full border border-dashed border-blue-400/30 absolute"
          />
          {/* Inner Glowing Core */}
          <div className="w-20 h-20 md:w-24 md:h-24 rounded-full bg-gradient-to-tr from-blue-600/20 to-cyan-400/20 backdrop-blur-sm border border-blue-400/50 relative overflow-hidden shadow-inner">
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              className="w-full h-full absolute inset-0"
            >
              {/* Water fluid effect */}
              <div className="absolute top-0 left-0 w-full h-full bg-blue-500/10" style={{ clipPath: 'polygon(0% 40%, 100% 60%, 100% 100%, 0% 100%)' }} />
              {/* Clothes Particles */}
              <div className="absolute top-6 left-6 w-3 h-3 bg-white rounded-sm shadow-[0_0_10px_white]" />
              <div className="absolute bottom-6 right-8 w-4 h-4 bg-[#FF6600] rounded-sm shadow-[0_0_10px_#FF6600]" />
            </motion.div>
          </div>
        </div>
      </div>

      {/* Base Platform */}
      <div className="w-40 md:w-48 h-4 bg-white/10 mt-2 rounded-full blur-md" />
      <div className="absolute -bottom-8 text-xs font-mono text-blue-400 tracking-widest opacity-60 whitespace-nowrap">{label}</div>
    </div>
  );
}