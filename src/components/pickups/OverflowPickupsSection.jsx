import React from 'react';
import { AlertTriangle, MapPin, Phone, CheckCircle, XCircle, Pencil, Bot, Clock } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PickupAuditInfo from '@/components/pickups/PickupAuditInfo';
import ServiceKindBadge from '@/components/pickups/ServiceKindBadge';

// Coletas agendadas além da capacidade dos slots do dia.
// Antes elas ficavam invisíveis na agenda — agora aparecem aqui.
export default function OverflowPickupsSection({ pickups, customerMap, formatBR, userMap, onStatusChange, onEdit }) {
  if (!pickups || pickups.length === 0) return null;

  return (
    <div className="border-t border-white/10 p-4 bg-orange-500/5">
      <h3 className="text-sm font-semibold text-orange-300 mb-3 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4" /> Coletas acima da capacidade do turno ({pickups.length})
      </h3>
      <div className="space-y-2">
        {pickups.map((pickup) => {
          const customer = customerMap[pickup.customer_id];
          return (
            <div key={pickup.id} className="rounded-lg p-3 border shadow-sm relative bg-orange-500/10 border-orange-500/30">
              {pickup.source === 'ai' && (
                <div className="absolute top-0 right-0 p-1 bg-purple-500/20 rounded-bl-lg">
                  <Bot className="w-3 h-3 text-purple-400" />
                </div>
              )}
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-white flex items-center gap-2 flex-wrap">
                    {customer?.full_name || 'Cliente Desconhecido'}
                    <ServiceKindBadge value={pickup.service_kind} />
                    <Badge variant="outline" className="text-[10px] py-0 h-5 bg-orange-500/20 text-orange-300 border-orange-500/30">EXCEDENTE</Badge>
                    {pickup.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  </h4>
                  <div className="flex flex-col gap-1 mt-1">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate max-w-[200px] md:max-w-md">{pickup.address}</span>
                    </div>
                    {customer?.phones?.[0] && (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <Phone className="w-3 h-3" />
                        <span>{customer.phones[0]}</span>
                      </div>
                    )}
                  </div>
                  {pickup.notes && <p className="text-xs text-gray-500 mt-2 italic">"{pickup.notes}"</p>}
                  <PickupAuditInfo pickup={pickup} userMap={userMap} />
                  {pickup.scheduled_at && (
                    <div className="flex items-center gap-1.5 mt-2 text-[10px] text-gray-500">
                      <Clock className="w-3 h-3" />
                      <span>Coleta para {formatBR(pickup.scheduled_at)}</span>
                    </div>
                  )}
                </div>
                {pickup.status === 'scheduled' && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10" title="Cancelar" onClick={() => onStatusChange(pickup.id, 'cancelled')}>
                      <XCircle className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-400 hover:text-green-300 hover:bg-green-500/10" title="Concluir" onClick={() => onStatusChange(pickup.id, 'completed')}>
                      <CheckCircle className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10" title="Editar" onClick={() => onEdit(pickup)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}