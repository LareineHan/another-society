import pg from 'pg';
import { createDb } from '@as/db';
import { createAppleProvider, devAppleProvider } from '@as/world-api';
import { publishOutbox, handleEvent, minuteMaintenance, dailyRetention, type OutboxMessage, type JobDeps } from './tasks';
import { reconcile } from '@as/db';

export * from './tasks';
export { reconcile, INTEGRITY_CHECKS, type ReconcileReport } from '@as/db';

export interface JobsEnv {
  HYPERDRIVE: Hyperdrive;
  EVENTS: Queue<OutboxMessage>;
  ENVIRONMENT: string;
  TOKEN_ENCRYPTION_KEY: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  DEV_AUTH?: string;
}

async function withDeps<T>(env: JobsEnv, fn: (deps: JobDeps) => Promise<T>): Promise<T> {
  if (env.DEV_AUTH === 'true' && env.ENVIRONMENT === 'production') throw new Error('DEV_AUTH must never be enabled in production');
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    const apple = env.DEV_AUTH === 'true'
      ? devAppleProvider
      : createAppleProvider({ clientId: env.APPLE_CLIENT_ID!, teamId: env.APPLE_TEAM_ID!, keyId: env.APPLE_KEY_ID!, privateKeyPem: env.APPLE_PRIVATE_KEY! });
    return await fn({ db: createDb(client), apple, tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY, log: (e) => console.log(JSON.stringify(e)) });
  } finally {
    await client.end();
  }
}

export default {
  /** Crons (wrangler.jobs.toml): every minute -> outbox + maintenance; daily -> retention + reconciliation. */
  async scheduled(event: ScheduledController, env: JobsEnv) {
    await withDeps(env, async (deps) => {
      if (event.cron === '17 9 * * *') {
        deps.log({ level: 'info', msg: 'retention', ...(await dailyRetention(deps.db)) });
        const report = await reconcile(deps.db);
        // Integrity failures page the operator before product analytics (Blueprint §58).
        deps.log({ level: report.ok ? 'info' : 'error', msg: 'ledger/ownership reconciliation', ...report });
        return;
      }
      const pub = await publishOutbox(deps.db, async (msgs) => {
        await env.EVENTS.sendBatch(msgs.map((body) => ({ body })));
      });
      const m = await minuteMaintenance(deps.db);
      if (pub.published || pub.failed || m.released || m.activated.length) deps.log({ level: 'info', msg: 'minute', ...pub, ...m });
    });
  },

  /** Queue consumer. Retries with backoff; exhausted messages go to the DLQ (see wrangler.jobs.toml). */
  async queue(batch: MessageBatch<OutboxMessage>, env: JobsEnv) {
    await withDeps(env, async (deps) => {
      for (const msg of batch.messages) {
        try {
          await handleEvent(deps, msg.body);
          msg.ack();
        } catch (e) {
          deps.log({ level: 'error', msg: 'event failed', event_id: msg.body.id, event_type: msg.body.event_type, attempts: msg.attempts, error: String(e) });
          msg.retry({ delaySeconds: Math.min(3600, 10 * 2 ** msg.attempts) });
        }
      }
    });
  },
} satisfies ExportedHandler<JobsEnv, OutboxMessage>;
