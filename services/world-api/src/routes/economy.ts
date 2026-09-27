import { Hono } from 'hono';
import { z } from 'zod';
import { DomainError } from '@as/domain';
import { sql, rows, one, maybeOne, enqueueOutbox } from '@as/db';
import { parseBody, parseQuery, type Vars } from '../http';
import { requireAuth, residentOf } from '../auth/middleware';
import { idempotent, idempotencyKeyOf } from '../idempotency';
import { postLedger, residentWalletId } from '../services/ledger';
import { itemOut, itemSelect, type ItemRow } from '../services/serialize';
import { rateLimit } from './auth';

const CatalogQuery = z.object({ city_id: z.string().uuid().optional() });
const PurchaseBody = z.object({ listing_id: z.string().uuid(), quantity: z.number().int().min(1).max(20) }).strict();

const listingSelect = sql`
  SELECT l.id, l.item_definition_id, l.unit_price, l.stock_quantity, l.status, l.city_id,
         d.definition_key, d.visual_definition->>'asset_id' AS asset_id, d.category, d.gift_eligible
    FROM store_listings l JOIN item_definitions d ON d.id = l.item_definition_id`;

type ListingRow = { id: string; item_definition_id: string; unit_price: number; stock_quantity: number | null; status: string; city_id: string | null; definition_key: string; asset_id: string; category: string; gift_eligible: boolean };

const listingOut = (l: ListingRow) => {
  const { stock_quantity, city_id: _city, ...rest } = l;
  return stock_quantity == null ? rest : { ...rest, stock_quantity };
};

export function economyRoutes() {
  const app = new Hono<{ Variables: Vars }>();
  for (const p of ['/inventory', '/wallet', '/catalog', '/store/*']) app.use(p, requireAuth());

  app.get('/inventory', async (c) => {
    const me = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const items = await rows<ItemRow>(db, sql`${itemSelect} WHERE ii.owner_resident_id = ${me} AND ii.state <> 'retired' ORDER BY ii.created_at, ii.id`);
    return c.json({ items: items.map(itemOut) });
  });

  app.get('/wallet', async (c) => {
    const me = residentOf(c.get('actor'));
    const db = await c.get('getDb')();
    const w = await one<{ currency_code: string; balance: number }>(db, sql`
      SELECT currency_code, balance FROM wallets WHERE wallet_kind = 'resident' AND resident_id = ${me} AND currency_code = 'WORLD'`);
    return c.json(w);
  });

  app.get('/catalog', async (c) => {
    const q = parseQuery(c, CatalogQuery);
    const db = await c.get('getDb')();
    const listings = await rows<ListingRow>(db, sql`
      ${listingSelect}
       WHERE l.status = 'active' AND l.starts_at <= now() AND (l.ends_at IS NULL OR l.ends_at > now())
         AND d.moderation_status = 'approved'
         AND (l.city_id IS NULL ${q.city_id ? sql`OR l.city_id = ${q.city_id}` : sql.empty()})
       ORDER BY d.gift_eligible, l.unit_price, d.definition_key`);
    return c.json({ listings: listings.map(listingOut) });
  });

  /**
   * Blueprint §28 purchase algorithm. Server decides price and balance; client sends only listing + quantity.
   * listing lock -> wallet locks (id order) -> balanced ledger -> item instances -> stock -> outbox, one transaction.
   */
  app.post('/store/purchases', async (c) => {
    const actor = c.get('actor');
    const me = residentOf(actor);
    await rateLimit(c, 'purchase', `resident:${me}`);
    const body = await parseBody(c, PurchaseBody);
    const apiKey = idempotencyKeyOf(c);
    return idempotent(c, 'store.purchase', async (tx) => {
      const l = await maybeOne<ListingRow & { seller_wallet_id: string; starts_at: Date; ends_at: Date | null; moderation_status: string; live: boolean }>(tx, sql`
        SELECT l.id, l.item_definition_id, l.unit_price, l.stock_quantity, l.status, l.city_id, l.seller_wallet_id,
               d.definition_key, d.visual_definition->>'asset_id' AS asset_id, d.category, d.gift_eligible, d.moderation_status,
               (l.starts_at <= now() AND (l.ends_at IS NULL OR l.ends_at > now())) AS live
          FROM store_listings l JOIN item_definitions d ON d.id = l.item_definition_id
         WHERE l.id = ${body.listing_id} FOR UPDATE OF l`);
      if (!l || l.status !== 'active' || !l.live || l.moderation_status !== 'approved') {
        throw new DomainError('conflict', 'This item is not available right now.');
      }
      if (l.stock_quantity != null && l.stock_quantity < body.quantity) throw new DomainError('conflict', 'Not enough stock left.', { stock_quantity: l.stock_quantity });
      const total = l.unit_price * body.quantity;
      if (!Number.isSafeInteger(total)) throw new DomainError('validation_error', 'Quantity too large.');
      const buyerWallet = await residentWalletId(tx, me);

      let transactionId: string | null = null;
      if (total > 0) {
        const posted = await postLedger(tx, {
          idempotencyKey: `store_purchase:${actor.userId}:${apiKey}`,
          type: 'store_purchase',
          actorResidentId: me,
          relatedType: 'store_listing',
          relatedId: l.id,
          metadata: { quantity: body.quantity, unit_price: l.unit_price },
          entries: [
            { walletId: buyerWallet, amount: -total },
            { walletId: l.seller_wallet_id, amount: total },
          ],
        });
        transactionId = posted.transactionId;
      }
      const items = await rows<{ id: string }>(tx, sql`
        INSERT INTO item_instances (definition_id, owner_resident_id, state, provenance)
        SELECT ${l.item_definition_id}, ${me}, 'inventory',
               jsonb_build_object('source', 'store', 'listing_id', ${l.id}::text, 'transaction_id', ${transactionId}::text)
          FROM generate_series(1, ${body.quantity})
        RETURNING id`);
      if (l.stock_quantity != null) {
        await tx.execute(sql`
          UPDATE store_listings SET stock_quantity = stock_quantity - ${body.quantity},
                 status = CASE WHEN stock_quantity - ${body.quantity} = 0 THEN 'sold_out' ELSE status END
           WHERE id = ${l.id}`);
      }
      await enqueueOutbox(tx, { eventType: 'store.purchased', aggregateType: 'store_listing', aggregateId: l.id, payload: { transaction_id: transactionId, quantity: body.quantity } });
      const wallet = await one<{ currency_code: string; balance: number }>(tx, sql`SELECT currency_code, balance FROM wallets WHERE id = ${buyerWallet}`);
      const full = await rows<ItemRow>(tx, sql`${itemSelect} WHERE ii.id = ANY(${sql.param(items.map((i) => i.id))}::uuid[]) ORDER BY ii.id`);
      return {
        status: 201,
        body: { request_id: c.get('requestId'), transaction_id: transactionId, wallet, items: full.map(itemOut) },
        resourceId: transactionId,
      };
    });
  });

  return app;
}
