import React from 'react';

export default function ConversationListItem({
  conversation,
  customer,
  unitLabel,
  isActive,
  unreadCount,
  preview,
  formatTime,
  onSelect
}) {
  const name = customer?.full_name && customer.full_name !== 'Cliente'
    ? customer.full_name
    : (customer?.phones?.[0] || 'Novo Cliente');
  const hasUnread = unreadCount > 0;

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-xl cursor-pointer transition-all border
        ${hasUnread
          ? 'bg-green-500/10 border-green-500/40'
          : isActive
            ? 'bg-white/10 border-white/10 shadow-lg'
            : 'border-transparent hover:bg-white/5 hover:border-white/5'
        }`}
    >
      <div className="flex justify-between items-start mb-1">
        <h3 className={`font-medium truncate ${
          hasUnread
            ? 'text-green-400 font-bold'
            : conversation.handoff_required
              ? 'text-[#FF6600] animate-pulse font-bold'
              : isActive ? 'text-white' : 'text-gray-200'
        }`}>
          {conversation.handoff_required && '🔔 '}
          {name}
        </h3>
        <div className="flex items-center gap-2 ml-2 shrink-0">
          {conversation.last_message_at && (
            <span className={`text-xs whitespace-nowrap ${hasUnread ? 'text-green-400 font-semibold' : 'text-gray-500'}`}>
              {formatTime(conversation.last_message_at)}
            </span>
          )}
          {hasUnread && (
            <span className="px-1.5 py-0.5 rounded-full bg-green-500 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center gap-2">
        <div className="max-w-[80%]">
          <p className={`text-sm truncate ${hasUnread ? 'text-green-200 font-medium' : 'text-gray-400'}`}>
            {conversation.handoff_required && <span className="text-[#FF6600] font-bold mr-1">[HUMANO]</span>}
            {hasUnread && <span className="mr-1">💬</span>}
            {preview || 'Toque para ver as mensagens'}
          </p>
          {unitLabel && (
            <p className="mt-1 text-[11px] font-medium text-[#FF6600] truncate">
              Unidade: {unitLabel}
            </p>
          )}
        </div>
        {conversation.handoff_required && (
          <span className="w-2 h-2 rounded-full bg-[#FF6600] animate-pulse" />
        )}
      </div>
    </div>
  );
}