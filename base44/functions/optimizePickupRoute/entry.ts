import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours <= 0) return `${minutes} min`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatDistance(totalMeters) {
  return `${(totalMeters / 1000).toFixed(1)} km`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { origin_address, stops } = await req.json();

    if (!origin_address || !Array.isArray(stops)) {
      return Response.json({ error: 'origin_address e stops são obrigatórios' }, { status: 400 });
    }

    if (stops.length === 0) {
      return Response.json({
        ordered_stops: [],
        total_distance_text: '0 km',
        total_duration_text: '0 min'
      });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_MAPS_API_KEY não configurada' }, { status: 500 });
    }

    const directionsUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
    directionsUrl.searchParams.set('origin', origin_address);
    directionsUrl.searchParams.set('destination', origin_address);
    directionsUrl.searchParams.set('waypoints', `optimize:true|${stops.map((stop) => stop.address).join('|')}`);
    directionsUrl.searchParams.set('mode', 'driving');
    directionsUrl.searchParams.set('language', 'pt-BR');
    directionsUrl.searchParams.set('region', 'br');
    directionsUrl.searchParams.set('key', apiKey);

    const response = await fetch(directionsUrl.toString());
    const data = await response.json();

    if (!response.ok || data.status !== 'OK' || !data.routes?.[0]) {
      return Response.json({
        error: data.error_message || `Erro ao calcular rota: ${data.status || response.status}`
      }, { status: 500 });
    }

    const route = data.routes[0];
    const waypointOrder = route.waypoint_order || stops.map((_, index) => index);
    const orderedStops = waypointOrder.map((index) => stops[index]);
    const oneWayLegs = (route.legs || []).slice(0, orderedStops.length);

    const enrichedStops = orderedStops.map((stop, index) => ({
      ...stop,
      order: index + 1,
      leg_distance_text: oneWayLegs[index]?.distance?.text || null,
      leg_duration_text: oneWayLegs[index]?.duration?.text || null
    }));

    const totalDistanceMeters = oneWayLegs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
    const totalDurationSeconds = oneWayLegs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);

    return Response.json({
      ordered_stops: enrichedStops,
      total_distance_text: formatDistance(totalDistanceMeters),
      total_duration_text: formatDuration(totalDurationSeconds)
    });
  } catch (error) {
    console.error('Error in optimizePickupRoute:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});