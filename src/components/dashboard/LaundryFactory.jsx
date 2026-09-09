import React from 'react';
import { motion } from 'framer-motion';

export default function LaundryFactory() {
  return (
    <div className="w-full h-64 md:h-80 relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#2a1b4e] to-[#1a0b36] border border-white/10 shadow-2xl flex items-center justify-center p-8">
      {/* Ambient Steam/Fog */}
      <motion.div 
        animate={{ opacity: [0.3, 0.6, 0.3], x: [-20, 20, -20] }}
        transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"
      />

      <div className="flex items-center justify-around w-full max-w-4xl relative z-10 gap-8">
        
        {/* Machine 1: Industrial Washer */}
        <div className="relative group">
          <div className="w-32 h-40 bg-gray-200 rounded-2xl relative shadow-lg overflow-hidden border-4 border-gray-300 flex flex-col items-center">
            {/* Top Display Panel */}
            <div className="w-full h-8 bg-[#4C12A1] flex items-center justify-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <div className="w-12 h-2 bg-black/30 rounded-full" />
            </div>
            
            {/* Drum Window */}
            <div className="mt-4 w-24 h-24 rounded-full border-4 border-gray-400 bg-blue-900 overflow-hidden relative shadow-inner">
              {/* Spinning Clothes/Water */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-full h-full absolute inset-0"
              >
                 <div className="absolute inset-0 bg-gradient-to-tr from-blue-600 to-cyan-300 opacity-60" />
                 {/* Clothes simulating shapes */}
                 <div className="absolute top-2 left-4 w-6 h-6 bg-white rounded-full opacity-80" />
                 <div className="absolute bottom-4 right-6 w-8 h-8 bg-[#FF6600] rounded-sm opacity-80" />
                 <div className="absolute top-8 right-2 w-5 h-5 bg-purple-500 rounded-full opacity-80" />
              </motion.div>
              {/* Glass Reflection */}
              <div className="absolute top-2 left-2 w-8 h-4 bg-white opacity-20 rounded-full rotate-45" />
            </div>
            
            {/* Label */}
            <div className="absolute bottom-2 text-[8px] font-bold text-gray-500 tracking-widest">5àSEC TURBO</div>
          </div>
          {/* Floor Shadow */}
          <div className="absolute -bottom-4 left-2 w-28 h-4 bg-black/40 blur-md rounded-full" />
        </div>

        {/* Conveyor Belt System connecting Machine to Iron */}
        <div className="hidden md:flex flex-1 h-4 bg-gray-700 rounded-full relative overflow-hidden mx-4 mt-20 border-t border-gray-600">
           <motion.div 
             animate={{ x: [-100, 300] }}
             transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
             className="absolute top-0 left-0 flex gap-12"
           >
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="relative -top-3">
                   <Shirt className="w-8 h-8 text-white opacity-80" fill="currentColor" />
                </div>
              ))}
           </motion.div>
        </div>

        {/* Machine 2: Industrial Iron/Press */}
        <div className="relative group">
          <div className="w-36 h-28 bg-gray-200 rounded-lg relative shadow-lg flex flex-col justify-end items-center border-b-8 border-gray-400">
             
             {/* Press Arm */}
             <motion.div
               animate={{ y: [0, 15, 0], rotateX: [0, 5, 0] }}
               transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
               className="absolute -top-16 w-32 h-4 bg-gray-600 rounded-full origin-left z-20 flex items-center justify-center"
             >
                <div className="w-4 h-24 bg-gray-500 absolute left-4 -top-12" />
                {/* Steam Head */}
                <div className="w-24 h-12 bg-gray-300 rounded-b-xl border-b-4 border-gray-400 absolute top-full mt-[-4px] shadow-lg flex items-center justify-center">
                    <span className="text-[8px] text-gray-500 font-bold">STEAM PRO</span>
                </div>
             </motion.div>

             {/* Steam Effect */}
             <motion.div
               animate={{ opacity: [0, 0.8, 0], scale: [0.5, 1.5, 2], y: -20 }}
               transition={{ duration: 3, repeat: Infinity, times: [0.4, 0.5, 0.8] }}
               className="absolute top-0 w-20 h-20 bg-white blur-xl rounded-full opacity-0 z-30"
             />

             {/* Ironing Board Surface */}
             <div className="w-32 h-4 bg-[#FF6600] rounded-full mt-2 relative z-10" />
             
             {/* Base */}
             <div className="w-24 h-16 bg-gray-300 rounded-t-lg mt-1 border border-gray-400 relative">
                <div className="absolute bottom-2 right-2 w-2 h-2 rounded-full bg-red-500" />
                <div className="absolute bottom-2 right-5 w-2 h-2 rounded-full bg-yellow-500" />
             </div>
          </div>
           {/* Floor Shadow */}
           <div className="absolute -bottom-4 left-4 w-28 h-4 bg-black/40 blur-md rounded-full" />
        </div>

      </div>

      <div className="absolute bottom-4 right-6 bg-black/30 backdrop-blur-md px-3 py-1 rounded-full border border-white/5 text-xs text-white/60 font-mono">
        SISTEMA OPERACIONAL • ONLINE
      </div>
    </div>
  );
}

// Icon helper
function Shirt({ className, ...props }) {
    return (
        <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className={className}
            {...props}
        >
            <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
        </svg>
    )
}