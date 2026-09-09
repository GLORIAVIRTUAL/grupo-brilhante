import React from 'react';
import { motion } from 'framer-motion';
import WasherMachine from '@/components/dashboard/WasherMachine';
import PressMachine from '@/components/dashboard/PressMachine';
import DryerMachine from '@/components/dashboard/DryerMachine';
import DryCleanMachine from '@/components/dashboard/DryCleanMachine';
import MachineDropZone from '@/components/dashboard/MachineDropZone';

export default function LaundryFactoryV2() {
  return (
    <div className="w-full relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#1a0b36] via-[#2a1b4e] to-[#1a0b36] border border-white/10 shadow-2xl flex items-center justify-center p-8 py-12 group">
      
      {/* Tech Grid Background */}
      <div className="absolute inset-0 opacity-20 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
      
      {/* Ambient Glow */}
      <div className="absolute top-1/2 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-[100px]" />
      <div className="absolute top-1/2 right-1/4 w-64 h-64 bg-[#FF6600]/10 rounded-full blur-[100px]" />

      <div className="flex flex-col gap-12 w-full max-w-5xl relative z-10">

        {/* Top Row: Washers, Dryer, Dry Clean */}
        <div className="flex items-center justify-around w-full gap-4 md:gap-8 flex-wrap md:flex-nowrap">
          <MachineDropZone machineId="WSH-9001" timeKey="wash_time" accent="text-blue-400" accentRing="ring-blue-400">
            <WasherMachine label="LAVAR 1" code="WSH-9001" />
          </MachineDropZone>
          <MachineDropZone machineId="WSH-9002" timeKey="wash_time" accent="text-blue-400" accentRing="ring-blue-400">
            <WasherMachine label="LAVAR 2" code="WSH-9002" />
          </MachineDropZone>
          <MachineDropZone machineId="WSH-9003" timeKey="wash_time" accent="text-blue-400" accentRing="ring-blue-400">
            <WasherMachine label="LAVAR 3" code="WSH-9003" />
          </MachineDropZone>
          <MachineDropZone machineId="DRY-7000" timeKey="dry_time" accent="text-fuchsia-400" accentRing="ring-fuchsia-400">
            <DryerMachine label="SECAR 1" code="DRY-7000" />
          </MachineDropZone>
          <MachineDropZone machineId="DRC-5000" timeKey="dry_clean_time" accent="text-emerald-400" accentRing="ring-emerald-400">
            <DryCleanMachine label="LAVAGEM SECO 1" code="DRC-5000" />
          </MachineDropZone>
        </div>

        {/* Bottom Row: Presses */}
        <div className="flex items-center justify-center w-full gap-8 md:gap-16 flex-wrap md:flex-nowrap">
          <MachineDropZone machineId="PRS-X1" timeKey="iron_time" accent="text-orange-400" accentRing="ring-orange-400">
            <PressMachine label="PASSAR 1" code="PRS-X1" />
          </MachineDropZone>
          <MachineDropZone machineId="PRS-X2" timeKey="iron_time" accent="text-orange-400" accentRing="ring-orange-400">
            <PressMachine label="PASSAR 2" code="PRS-X2" />
          </MachineDropZone>
        </div>

      </div>
      
      {/* Overlay Status */}
      <div className="absolute top-4 right-6 flex items-center gap-2">
         <div className="flex gap-1">
            <span className="w-1 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-3 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
         </div>
         <span className="text-[10px] font-mono text-white/60">SYSTEM OPTIMIZED</span>
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
            fill="currentColor" 
            className={className}
            {...props}
        >
            <path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" />
        </svg>
    )
}