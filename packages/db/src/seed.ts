import { findAsset, toDbContentRating } from '@as/asset-manifest';
import catalog from '../seed/core-catalog.dev.json';
import { sql, one, maybeOne, withTx, pgJson, type Db } from './client';

export const SYSTEM_WALLETS = { mint: 'MINT', sink: 'SYSTEM_SINK' } as const;

interface CatalogItem {
  definition_key: string;
  category: string;
  kind: string;
  unit_price: number;
  gift_eligible: boolean;
  asset_id: string;
  starter_kit: boolean;
}

/**
 * Idempotent base seed: system wallets, v0.1 system item definitions (IMPLEMON-authored),
 * the system store catalog, and default (off) feature flags for not-yet-surfaced features.
 * Safe to run on every deploy.
 */
export async function seedBase(db: Db): Promise<{ definitions: number; listings: number }> {
  return withTx(db, async (tx) => {
    await tx.execute(sql`
      INSERT INTO wallets (wallet_kind, system_code, allow_negative) VALUES ('mint', ${SYSTEM_WALLETS.mint}, true)
      ON CONFLICT (system_code, currency_code) WHERE wallet_kind IN ('mint','sink','system') DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO wallets (wallet_kind, system_code, allow_negative) VALUES ('sink', ${SYSTEM_WALLETS.sink}, false)
      ON CONFLICT (system_code, currency_code) WHERE wallet_kind IN ('mint','sink','system') DO NOTHING`);
    const sink = await one<{ id: string }>(tx, sql`SELECT id FROM wallets WHERE wallet_kind = 'sink' AND system_code = ${SYSTEM_WALLETS.sink}`);

    let definitions = 0;
    let listings = 0;
    for (const item of (catalog as { items: CatalogItem[] }).items) {
      const found = findAsset(item.asset_id);
      if (!found) throw new Error(`catalog item ${item.definition_key} references unknown asset ${item.asset_id}`);
      const { pack, asset } = found;
      const visual = {
        asset_id: asset.asset_id, pack_id: pack.pack_id, pack_version: pack.pack_version,
        kind: asset.kind, footprint_u: asset.footprint_u, rotations: asset.rotations,
      };
      const def = await one<{ id: string; inserted: boolean }>(tx, sql`
        INSERT INTO item_definitions (definition_key, source_kind, category, visual_definition, gift_eligible, tradable, content_rating)
        VALUES (${item.definition_key}, 'system', ${item.category}, ${pgJson(visual)}, ${item.gift_eligible}, false, ${toDbContentRating(asset.content_rating)})
        ON CONFLICT (definition_key) DO UPDATE SET visual_definition = EXCLUDED.visual_definition, updated_at = now()
        RETURNING id, (xmax = 0) AS inserted`);
      if (def.inserted) definitions++;
      const existing = await maybeOne<{ id: string }>(tx, sql`
        SELECT id FROM store_listings WHERE seller_kind = 'system' AND item_definition_id = ${def.id} AND item_instance_id IS NULL AND city_id IS NULL`);
      if (!existing) {
        await tx.execute(sql`
          INSERT INTO store_listings (city_id, seller_kind, seller_wallet_id, item_definition_id, unit_price, stock_quantity)
          VALUES (NULL, 'system', ${sink.id}, ${def.id}, ${item.unit_price}, NULL)`);
        listings++;
      }
    }

    for (const key of ['creator.enabled', 'procurement.enabled', 'market.enabled', 'visits.exact_counts']) {
      await tx.execute(sql`INSERT INTO feature_flags (key, enabled) VALUES (${key}, false) ON CONFLICT (key) DO NOTHING`);
    }
    return { definitions, listings };
  });
}
