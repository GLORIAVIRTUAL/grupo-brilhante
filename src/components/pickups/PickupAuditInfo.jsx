import React from 'react';
import { Bot, User } from 'lucide-react';
import { formatBrasiliaDateTime } from '@/lib/pickupDateTime';

export default function PickupAuditInfo({ pickup, userMap = {} }) {
  if (!pickup?.created_date) return null;
  const isAi = pickup.source === 'ai';
  const creator = isAi
    ? 'Glória (IA)'
    : pickup.created_by_name || userMap[pickup.created_by_id]?.full_name || userMap[pickup.created_by_id]?.email || 'Usuário do sistema';
  const Icon = isAi ? Bot : User;

  return (
    <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-400">
      <Icon className="w-3 h-3" />
      <span>Inserido em {formatBrasiliaDateTime(pickup.created_date)} por {creator}</span>
    </div>
  );
}