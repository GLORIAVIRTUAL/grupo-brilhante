import React from 'react';
import { motion } from 'framer-motion';

export default function StatsCard({ title, value, subtext, icon: Icon, color = "purple" }) {
  const gradients = {
    purple: "from-[#4C12A1]/20 to-[#4C12A1]/5 border-[#4C12A1]/30",
    orange: "from-[#FF6600]/20 to-[#FF6600]/5 border-[#FF6600]/30",
    blue: "from-blue-600/20 to-blue-600/5 border-blue-500/30",
    green: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30"
  };

  return (
    <motion.div
      whileHover={{ y: -5, boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)" }}
      className={`relative overflow-hidden rounded-2xl p-6 bg-gradient-to-br ${gradients[color]} border backdrop-blur-md`}
    >
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="p-3 rounded-xl bg-white/10 backdrop-blur-sm">
            <Icon className="w-6 h-6 text-white" />
          </div>
          {color === 'orange' && (
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6600] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FF6600]"></span>
            </span>
          )}
        </div>
        
        <h3 className="text-white/60 text-sm font-medium mb-1">{title}</h3>
        <div className="text-3xl font-bold text-white mb-2">{value}</div>
        <p className="text-white/40 text-xs">{subtext}</p>
      </div>

      {/* Decorative background glow */}
      <div className={`absolute -bottom-4 -right-4 w-24 h-24 rounded-full blur-[40px] opacity-40 
        ${color === 'orange' ? 'bg-[#FF6600]' : 'bg-[#4C12A1]'}`} 
      />
    </motion.div>
  );
}