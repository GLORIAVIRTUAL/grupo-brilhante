async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function recordDomainEvent(db, input) {
  const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const eventKey = String(input.eventKey || `${input.eventType}:${input.aggregateId}:${crypto.randomUUID()}`);
  const payloadHash = await sha256Hex(JSON.stringify(payload));
  const existing = await db.DomainEvent.filter({ event_key: eventKey }, '-occurred_at', 2).catch(() => []);
  if (existing.length) {
    if (existing[0].payload_hash !== payloadHash) throw new Error('domain_event_key_conflict');
    return { event: existing[0], idempotent: true };
  }
  const event = await db.DomainEvent.create({
    event_key: eventKey,
    event_type: String(input.eventType),
    aggregate_type: String(input.aggregateType),
    aggregate_id: String(input.aggregateId),
    legal_entity_id: String(input.legalEntityId),
    unit_id: input.unitId || null,
    occurred_at: input.occurredAt || new Date().toISOString(),
    actor_type: input.actorType || 'user',
    actor_id: input.actorId || null,
    correlation_id: input.correlationId || null,
    causation_id: input.causationId || null,
    schema_version: Number(input.schemaVersion || 1),
    payload,
    payload_hash: payloadHash,
    status: 'recorded',
    metadata: input.metadata || {},
  });
  return { event, idempotent: false };
}
