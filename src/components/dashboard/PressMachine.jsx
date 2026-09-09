import React from 'react';
import { motion } from 'framer-motion';

export default function PressMachine({ label = 'PASSAR 1', code = 'PRS-X1' }) {
  return (
    <div className="relative flex flex-col items-center">
      {/* Holographic Container */}
      <div className="w-32 h-44 md:w-40 md:h-48 bg-white/5 backdrop-blur-md rounded-2xl border border-white/20 relative overflow-hidden flex flex-col shadow-[0_0_30px_rgba(255,102,0,0.2)]">
        {/* Header */}
        <div className="h-8 border-b border-white/10 bg-white/5 flex items-center px-3 justify-between">
          <span className="text-[9px] font-mono text-orange-300">{code}</span>
          <div className="w-2 h-2 rounded-full bg-[#FF6600] animate-pulse" />
        </div>

        <div className="flex-1 relative">
          {/* Robotic Arm Base */}
          <div className="absolute top-0 right-4 w-4 h-24 bg-gray-600/50 rounded-full" />

          {/* Moving Arm */}
          <motion.div
            animate={{ y: [0, 15, 0], rotateZ: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-4 right-6 origin-top-right"
          >
            <div className="w-24 h-4 bg-gray-500 rounded-l-full relative">
              {/* Press Head */}
              <div className="absolute left-0 top-2 w-16 h-8 bg-gradient-to-b from-gray-300 to-gray-400 rounded-b-xl shadow-lg border-b-2 border-[#FF6600] flex items-center justify-center overflow-hidden">
                <div className="w-full h-full bg-[#FF6600]/10" />
              </div>
            </div>
          </motion.div>

          {/* Ironing Bed */}
          <div className="absolute bottom-8 left-4 right-4 h-2 bg-[#FF6600]/50 rounded-full blur-[2px]" />
          <div className="absolute bottom-8 left-4 right-4 h-1 bg-white/20 rounded-full" />

          {/* Steam Particles */}
          <motion.div
            animate={{ opacity: [0, 1, 0], y: -30, scale: 1.5 }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute bottom-10 left-10 w-12 h-12 bg-white/20 rounded-full blur-xl"
          />
        </div>
      </div>

      {/* Base Platform */}
      <div className="w-40 md:w-48 h-4 bg-white/10 mt-2 rounded-full blur-md" />
      <div className="absolute -bottom-8 text-xs font-mono text-orange-400 tracking-widest opacity-60 whitespace-nowrap">{label}</div>
    </div>
  );
}