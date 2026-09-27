import { sql, rows, one, maybeOne, withTx, pgJson, pgArray, type Db, type Tx } from '@as/db';
import { activateBundle } from './activation';
import { generatorVersionToInt, type WorldTemplate } from './types';

export interface ImportOptions {
  worldCode?: string;
  worldName?: string;
  regionCode?: string;
  regionName?: string;
}

export interface ImportResult {
  worldId: string;
  regionId: string;
  cityId: string;
  created: { city: boolean; districts: number; chunks: number; roadNodes: number; roadEdges: number; plots: number; civicAnchors: number; bundles: number };
  activatedBundles: string[];
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Import a validated world template (Blueprint §10).
 *
 * Idempotent and identity-preserving: existing entities (matched by stable key) are never
 * regenerated. If the template moves an entity that already exists, the import aborts with a
 * drift report instead of silently rewriting canonical coordinates.
 * Only new entities are inserted; initial_active bundles are activated at the end.
 */
export async function importWorldTemplate(db: Db, t: WorldTemplate, opts: ImportOptions = {}): Promise<ImportResult> {
  const templateSha = await sha256Hex(JSON.stringify(t));
  return withTx(db, async (tx) => {
    const world = await one<{ id: string }>(tx, sql`
      INSERT INTO worlds (code, display_name) VALUES (${opts.worldCode ?? 'main'}, ${opts.worldName ?? 'Another Society'})
      ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`);
    const region = await one<{ id: string }>(tx, sql`
      INSERT INTO regions (world_id, code, display_name) VALUES (${world.id}, ${opts.regionCode ?? 'founding'}, ${opts.regionName ?? 'Founding Region'})
      ON CONFLICT (world_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id`);

    let city = await maybeOne<{ id: string }>(tx, sql`
      SELECT id FROM cities WHERE region_id = ${region.id} AND code = ${t.city.stable_key} FOR UPDATE`);
    const cityCreated = !city;
    if (!city) {
      city = await one<{ id: string }>(tx, sql`
        INSERT INTO cities (region_id, code, display_name, template_id, generator_version, template_generator_version, theme)
        VALUES (${region.id}, ${t.city.stable_key}, ${t.city.name}, ${t.template_id}, ${generatorVersionToInt(t.generator_version)},
                ${t.generator_version}, ${t.city.theme})
        RETURNING id`);
      await tx.execute(sql`INSERT INTO wallets (wallet_kind, city_id) VALUES ('city', ${city.id})`);
    }
    const cityId = city.id;

    await assertNoDrift(tx, cityId, t);

    // Districts
    const districts = await rows<{ id: string }>(tx, sql`
      INSERT INTO districts (city_id, code, display_name, activation_order)
      SELECT ${cityId}, d.stable_key, d.name, d.activation_order
        FROM jsonb_to_recordset(${pgJson(t.districts)}) AS d(stable_key text, name text, activation_order int)
      ON CONFLICT (city_id, code) DO NOTHING RETURNING id`);

    // Activation bundles
    const bundles = await rows<{ stable_key: string }>(tx, sql`
      INSERT INTO city_activation_bundles (city_id, stable_key, activation_order, plot_count, initial_active)
      SELECT ${cityId}, b.stable_key, b.activation_order, b.plot_count, b.initial_active
        FROM jsonb_to_recordset(${pgJson(t.activation_bundles)}) AS b(stable_key text, activation_order int, plot_count int, initial_active boolean)
      ON CONFLICT (city_id, stable_key) DO NOTHING RETURNING stable_key`);

    // Road nodes: skeleton (no bundle) is active immediately; bundle nodes wait for activation.
    const nodes = await rows<{ id: string }>(tx, sql`
      INSERT INTO road_nodes (city_id, x_u, y_u, node_kind, active, stable_template_key, activation_bundle)
      SELECT ${cityId}, n.x_u, n.y_u, n.node_kind, n.activation_bundle IS NULL, n.stable_key, n.activation_bundle
        FROM jsonb_to_recordset(${pgJson(t.road_nodes)}) AS n(stable_key text, x_u int, y_u int, node_kind text, activation_bundle text)
      ON CONFLICT (city_id, stable_template_key) DO NOTHING RETURNING id`);

    const edges = await rows<{ id: string }>(tx, sql`
      INSERT INTO road_edges (city_id, from_node_id, to_node_id, edge_kind, weight_milli, geometry_points, active, stable_template_key, activation_bundle)
      SELECT ${cityId}, f.id, tn.id, e.edge_kind, e.weight_u, e.polyline, e.activation_bundle IS NULL, e.stable_key, e.activation_bundle
        FROM jsonb_to_recordset(${pgJson(t.road_edges)}) AS e(stable_key text, from_node text, to_node text, edge_kind text, weight_u int, polyline jsonb, activation_bundle text)
        JOIN road_nodes f ON f.city_id = ${cityId} AND f.stable_template_key = e.from_node
        JOIN road_nodes tn ON tn.city_id = ${cityId} AND tn.stable_template_key = e.to_node
      ON CONFLICT (city_id, stable_template_key) DO NOTHING RETURNING id`);

    // Chunks referenced by plots. district_id is set only when every plot in the chunk shares one district.
    const chunks = await rows<{ id: string }>(tx, sql`
      INSERT INTO chunks (city_id, district_id, chunk_x, chunk_y)
      SELECT ${cityId}, CASE WHEN count(DISTINCT p.district_key) = 1 THEN (SELECT id FROM districts WHERE city_id = ${cityId} AND code = min(p.district_key)) END,
             p.chunk_x, p.chunk_y
        FROM jsonb_to_recordset(${pgJson(t.plots)}) AS p(chunk_x int, chunk_y int, district_key text)
       GROUP BY p.chunk_x, p.chunk_y
      ON CONFLICT (city_id, chunk_x, chunk_y) DO NOTHING RETURNING id`);

    const plots = await rows<{ id: string }>(tx, sql`
      INSERT INTO plots (city_id, district_id, chunk_id, stable_template_key, center_x_u, center_y_u, terrain_type, zone_type,
                         scenic_tags, frontage_node_id, build_bounds, activation_bundle, activation_order, status)
      SELECT ${cityId}, d.id, c.id, p.stable_key, (p.center->>'x_u')::int, (p.center->>'y_u')::int, p.terrain, p.zone,
             ARRAY(SELECT jsonb_array_elements_text(p.scenic_tags)), rn.id, p.build_bounds, p.activation_bundle, p.activation_order, 'latent'
        FROM jsonb_to_recordset(${pgJson(t.plots)}) AS p(stable_key text, district_key text, activation_bundle text, activation_order int,
             chunk_x int, chunk_y int, center jsonb, terrain text, zone text, frontage_node text, build_bounds jsonb, scenic_tags jsonb)
        JOIN districts d ON d.city_id = ${cityId} AND d.code = p.district_key
        JOIN chunks c ON c.city_id = ${cityId} AND c.chunk_x = p.chunk_x AND c.chunk_y = p.chunk_y
        JOIN road_nodes rn ON rn.city_id = ${cityId} AND rn.stable_template_key = p.frontage_node
      ON CONFLICT (city_id, stable_template_key) DO NOTHING RETURNING id`);

    const civic = await rows<{ id: string }>(tx, sql`
      INSERT INTO civic_anchors (city_id, stable_template_key, kind, x_u, y_u, road_node_id)
      SELECT ${cityId}, a.stable_key, a.kind, (a.position->>'x_u')::int, (a.position->>'y_u')::int, rn.id
        FROM jsonb_to_recordset(${pgJson(t.civic_anchors)}) AS a(stable_key text, kind text, position jsonb, road_node text)
        JOIN road_nodes rn ON rn.city_id = ${cityId} AND rn.stable_template_key = a.road_node
      ON CONFLICT (city_id, stable_template_key) DO NOTHING RETURNING id`);

    // Every template entity must now exist (inserts silently skip rows whose joins failed).
    const missingEdges = t.road_edges.length - (await countPresent(tx, cityId, 'road_edges', t.road_edges.map((e) => e.stable_key)));
    const missingPlots = t.plots.length - (await countPresent(tx, cityId, 'plots', t.plots.map((p) => p.stable_key)));
    if (missingEdges || missingPlots) {
      throw new Error(`import incomplete: ${missingEdges} edges / ${missingPlots} plots reference unknown nodes, districts or chunks`);
    }

    await tx.execute(sql`
      INSERT INTO world_template_imports (city_id, template_id, generator_version, template_sha256, plots_added, road_nodes_added, road_edges_added)
      VALUES (${cityId}, ${t.template_id}, ${t.generator_version}, ${templateSha}, ${plots.length}, ${nodes.length}, ${edges.length})`);

    const activatedBundles: string[] = [];
    const initial = await rows<{ stable_key: string }>(tx, sql`
      SELECT stable_key FROM city_activation_bundles
       WHERE city_id = ${cityId} AND initial_active AND status = 'latent' ORDER BY activation_order`);
    for (const b of initial) {
      await activateBundle(tx, cityId, b.stable_key, 'initial');
      activatedBundles.push(b.stable_key);
    }

    return {
      worldId: world.id,
      regionId: region.id,
      cityId,
      created: {
        city: cityCreated, districts: districts.length, chunks: chunks.length, roadNodes: nodes.length,
        roadEdges: edges.length, plots: plots.length, civicAnchors: civic.length, bundles: bundles.length,
      },
      activatedBundles,
    };
  });
}

async function countPresent(tx: Tx, cityId: string, table: 'plots' | 'road_edges', keys: string[]): Promise<number> {
  const q = table === 'plots'
    ? sql`SELECT count(*)::int AS n FROM plots WHERE city_id = ${cityId} AND stable_template_key = ANY(${pgArray(keys)}::text[])`
    : sql`SELECT count(*)::int AS n FROM road_edges WHERE city_id = ${cityId} AND stable_template_key = ANY(${pgArray(keys)}::text[])`;
  return (await one<{ n: number }>(tx, q)).n;
}

/** Refuse to re-import a template that moves existing canonical geometry. */
async function assertNoDrift(tx: Tx, cityId: string, t: WorldTemplate): Promise<void> {
  const drift: string[] = [];
  const existingNodes = await rows<{ k: string; x_u: number; y_u: number }>(tx, sql`
    SELECT stable_template_key AS k, x_u, y_u FROM road_nodes WHERE city_id = ${cityId}`);
  const nodeMap = new Map(existingNodes.map((n) => [n.k, n]));
  for (const n of t.road_nodes) {
    const e = nodeMap.get(n.stable_key);
    if (e && (e.x_u !== n.x_u || e.y_u !== n.y_u)) drift.push(`road_node ${n.stable_key}`);
  }
  const existingPlots = await rows<{ k: string; x: number; y: number; frontage: string }>(tx, sql`
    SELECT p.stable_template_key AS k, p.center_x_u AS x, p.center_y_u AS y, rn.stable_template_key AS frontage
      FROM plots p JOIN road_nodes rn ON rn.id = p.frontage_node_id WHERE p.city_id = ${cityId}`);
  const plotMap = new Map(existingPlots.map((p) => [p.k, p]));
  for (const p of t.plots) {
    const e = plotMap.get(p.stable_key);
    if (e && (e.x !== p.center.x_u || e.y !== p.center.y_u || e.frontage !== p.frontage_node)) drift.push(`plot ${p.stable_key}`);
  }
  if (drift.length) {
    throw new Error(`template drift: ${drift.length} existing entities would move (${drift.slice(0, 5).join(', ')}). ` +
      'Canonical identity/coordinates are never regenerated; author new keys instead.');
  }
}
