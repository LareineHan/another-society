import { Hono } from 'hono';
import { z } from 'zod';
import { validateDisplayName, validateMiniDefinition } from '@as/domain';
import { sql, withTx, one } from '@as/db';
import { parseBody, type Vars } from '../http';
import { requireAuth, residentOf } from '../auth/middleware';
import { residentOut, type ResidentRow } from '../services/serialize';
import { rateLimit } from './auth';

const PatchResident = z.object({ display_name: z.string().min(1).max(64).optional() }).strict();
const PutMini = z.object({ definition: z.record(z.unknown()) }).strict();

export function residentRoutes() {
  const app = new Hono<{ Variables: Vars }>();
  app.use('/resident', requireAuth());
  app.use('/resident/*', requireAuth());

  app.get('/resident', async (c) => {
    const db = await c.get('getDb')();
    const r = await one<ResidentRow>(db, sql`
      SELECT id, display_name, public_tag, mini_definition, onboarding_state FROM residents WHERE id = ${residentOf(c.get('actor'))}`);
    return c.json(await residentOut(db, r));
  });

  app.patch('/resident', async (c) => {
    const rid = residentOf(c.get('actor'));
    await rateLimit(c, 'write', `resident:${rid}`);
    const body = await parseBody(c, PatchResident);
    const db = await c.get('getDb')();
    const r = await withTx(db, async (tx) => {
      if (body.display_name !== undefined) {
        // Display name is the main public free-text surface (Blueprint §14.6): NFC, 1–24 graphemes, screened.
        const v = validateDisplayName(body.display_name);
        await tx.execute(sql`UPDATE residents SET display_name = ${v.displayName}, display_name_norm = ${v.displayNameNorm}, updated_at = now()
                              WHERE id = ${rid}`);
      }
      return one<ResidentRow>(tx, sql`SELECT id, display_name, public_tag, mini_definition, onboarding_state FROM residents WHERE id = ${rid}`);
    });
    return c.json(await residentOut(db, r));
  });

  app.put('/resident/mini', async (c) => {
    const rid = residentOf(c.get('actor'));
    await rateLimit(c, 'write', `resident:${rid}`);
    const body = await parseBody(c, PutMini);
    const mini = validateMiniDefinition(body.definition);
    const db = await c.get('getDb')();
    const r = await one<ResidentRow>(db, sql`
      UPDATE residents SET mini_definition = ${JSON.stringify(mini)}::jsonb, updated_at = now(),
             onboarding_state = CASE WHEN onboarding_state = 'claimed' THEN 'complete' ELSE onboarding_state END
       WHERE id = ${rid}
       RETURNING id, display_name, public_tag, mini_definition, onboarding_state`);
    return c.json(await residentOut(db, r));
  });

  return app;
}
