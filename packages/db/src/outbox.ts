import { sql, type Executor } from './client';

export interface OutboxEvent {
  eventType: string;
  aggregateType: string;
  aggregateId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox (Blueprint §49): call inside the same transaction as the mutation.
 * A publisher moves pending rows to Cloudflare Queues; consumers are idempotent by event id.
 */
export async function enqueueOutbox(tx: Executor, e: OutboxEvent): Promise<void> {
  await tx.execute(sql`
    INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
    VALUES (${e.eventType}, ${e.aggregateType}, ${e.aggregateId ?? null}, ${JSON.stringify(e.payload)}::jsonb)`);
}
