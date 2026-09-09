import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { isSameBrasiliaDay } from '@/lib/pickupDateTime';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Route, Navigation, GripVertical, CheckCircle2, Loader2, Store, Clock3, MapPinned } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

function reorder(list, startIndex, endIndex) {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

function buildGoogleMapsUrl(origin, stops) {
  if (!origin || stops.length === 0) return null;
  const destination = stops[stops.length - 1].address;
  const waypoints = stops.slice(0, -1).map((stop) => stop.address).join('|');
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving'
  });
  if (waypoints) params.set('waypoints', waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export default function PickupRoutePlanner({ pickups, customers, customerMap, date, onStatusChange }) {
  const [stores, setStores] = useState([]);
  const [selectedStore, setSelectedStore] = useState('');
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeStops, setRouteStops] = useState([]);
  const [routeSummary, setRouteSummary] = useState(null);

  useEffect(() => {
    base44.entities.Unit.list('name', 100)
      .then((units) => {
        const mapped = units.map((u) => ({ name: u.name, address: u.address || u.name }));
        setStores(mapped);
        if (mapped.length > 0 && !selectedStore) setSelectedStore(mapped[0].name);
      })
      .catch((err) => console.error('Unit.list falhou:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduledPickups = useMemo(() => {
    return pickups.filter((pickup) => pickup.status === 'scheduled' && isSameBrasiliaDay(pickup.scheduled_at, date));
  }, [pickups, date]);

  const selectedStoreData = stores.find((store) => store.name === selectedStore);

  const handleOptimizeRoute = async () => {
    if (scheduledPickups.length === 0) {
      toast.error('Não há coletas agendadas para esta data.');
      return;
    }

    setLoadingRoute(true);
    try {
      const response = await base44.functions.invoke('optimizePickupRoute', {
        origin_address: selectedStoreData.address,
        stops: scheduledPickups.map((pickup) => ({
          id: pickup.id,
          address: pickup.address,
          customer_name: (customerMap || {})[pickup.customer_id]?.full_name || customers.find((customer) => customer.id === pickup.customer_id)?.full_name || 'Cliente',
          notes: pickup.notes || '',
          scheduled_at: pickup.scheduled_at,
          priority: pickup.priority
        }))
      });

      setRouteStops(response.data.ordered_stops || []);
      setRouteSummary(response.data);
      toast.success('Rota otimizada com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Não foi possível montar a rota.');
    } finally {
      setLoadingRoute(false);
    }
  };

  const handleOpenNavigation = () => {
    const url = buildGoogleMapsUrl(selectedStoreData?.address, routeStops);
    if (!url) {
      toast.error('Gere a rota antes de abrir a navegação.');
      return;
    }
    window.open(url, '_blank');
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    setRouteStops((current) => reorder(current, result.source.index, result.destination.index));
  };

  const handleCompleteStop = async (pickupId) => {
    await onStatusChange(pickupId, 'completed');
    setRouteStops((current) => current.filter((stop) => stop.id !== pickupId));
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 md:p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Route className="w-5 h-5 text-[#FF6600]" />
            Melhor rota do dia
          </h2>
          <p className="text-sm text-gray-400 mt-1">Escolha a loja de saída e gere a ordem mais rápida das paradas.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <Select value={selectedStore} onValueChange={setSelectedStore}>
            <SelectTrigger className="w-full md:w-[280px] bg-white/5 border-white/10 text-white">
              <SelectValue placeholder="Selecione a loja" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((store) => (
                <SelectItem key={store.name} value={store.name}>{store.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button onClick={handleOptimizeRoute} className="bg-[#FF6600] hover:bg-[#e55c00] gap-2" disabled={loadingRoute}>
            {loadingRoute ? <Loader2 className="w-4 h-4 animate-spin" /> : <Route className="w-4 h-4" />}
            Gerar rota
          </Button>

          <Button variant="outline" onClick={handleOpenNavigation} className="border-white/15 bg-transparent text-white hover:bg-white/10 gap-2">
            <Navigation className="w-4 h-4" />
            Abrir navegação
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge className="bg-blue-500/10 text-blue-300 border border-blue-500/20">
          {scheduledPickups.length} parada(s) agendada(s)
        </Badge>
        {routeSummary?.total_duration_text && (
          <Badge className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 gap-1">
            <Clock3 className="w-3 h-3" /> {routeSummary.total_duration_text}
          </Badge>
        )}
        {routeSummary?.total_distance_text && (
          <Badge className="bg-purple-500/10 text-purple-300 border border-purple-500/20 gap-1">
            <MapPinned className="w-3 h-3" /> {routeSummary.total_distance_text}
          </Badge>
        )}
      </div>

      {routeStops.length > 0 ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="pickup-route-stops">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-gray-300 flex items-center gap-2">
                  <Store className="w-4 h-4 text-[#FF6600]" />
                  Saída: <span className="font-medium text-white">{selectedStore}</span>
                </div>

                {routeStops.map((stop, index) => (
                  <Draggable key={stop.id} draggableId={stop.id} index={index}>
                    {(dragProvided) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col md:flex-row md:items-center gap-4"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div {...dragProvided.dragHandleProps} className="text-gray-500 cursor-grab">
                            <GripVertical className="w-5 h-5" />
                          </div>
                          <div className="w-8 h-8 rounded-full bg-[#FF6600]/15 text-[#FF6600] flex items-center justify-center text-sm font-bold shrink-0">
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="text-white font-medium truncate flex items-center gap-2">
                              {stop.customer_name}
                              {stop.priority && <Badge variant="destructive" className="text-[10px] py-0 h-4">PRIORIDADE</Badge>}
                            </div>
                            <div className="text-sm text-gray-400 truncate">{stop.address}</div>
                            {stop.notes && <div className="text-xs text-gray-500 mt-1">{stop.notes}</div>}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {stop.leg_duration_text && (
                            <Badge className="bg-white/5 text-gray-300 border border-white/10">{stop.leg_duration_text}</Badge>
                          )}
                          {stop.leg_distance_text && (
                            <Badge className="bg-white/5 text-gray-300 border border-white/10">{stop.leg_distance_text}</Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-white/15 bg-transparent text-white hover:bg-white/10"
                            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.address)}`, '_blank')}
                          >
                            Navegar
                          </Button>
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white gap-2"
                            onClick={() => handleCompleteStop(stop.id)}
                          >
                            <CheckCircle2 className="w-4 h-4" /> Entregue
                          </Button>
                        </div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-gray-500">
          Gere a rota para ver a ordem das paradas e abrir no Google Maps.
        </div>
      )}
    </div>
  );
}