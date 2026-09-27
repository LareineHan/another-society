import { CHUNK_SIZE_U } from '@as/domain';
import type { WorldTemplate } from './types';

export interface SemanticReport { errors: string[]; warnings: string[] }

/**
 * Checks the JSON Schema cannot express (Blueprint §6–7):
 * - unique stable keys, resolvable references
 * - every plot fronts a road node that is active no later than the plot's bundle
 * - each activation stage leaves the active road graph connected
 * - chunk indices match plot centers; bundle plot_count matches
 */
export function checkTemplateSemantics(t: WorldTemplate, opts: { production?: boolean } = {}): SemanticReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const uniq = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) errors.push(`duplicate ${label} stable_key "${k}"`);
      seen.add(k);
    }
  };
  uniq('district', t.districts.map((d) => d.stable_key));
  uniq('bundle', t.activation_bundles.map((b) => b.stable_key));
  uniq('road_node', t.road_nodes.map((n) => n.stable_key));
  uniq('road_edge', t.road_edges.map((e) => e.stable_key));
  uniq('plot', t.plots.map((p) => p.stable_key));
  uniq('civic_anchor', t.civic_anchors.map((c) => c.stable_key));

  const bundleOrder = new Map(t.activation_bundles.map((b) => [b.stable_key, b.activation_order]));
  const orders = t.activation_bundles.map((b) => b.activation_order);
  if (new Set(orders).size !== orders.length) errors.push('activation_bundles have duplicate activation_order');
  if (!t.activation_bundles.some((b) => b.initial_active)) errors.push('no initial_active bundle: the city would open with zero claimable plots');

  const nodes = new Map(t.road_nodes.map((n) => [n.stable_key, n]));
  const districts = new Set(t.districts.map((d) => d.stable_key));
  const stageOf = (bundle: string | null | undefined): number => (bundle == null ? -1 : bundleOrder.get(bundle) ?? Number.POSITIVE_INFINITY);

  for (const n of t.road_nodes) {
    if (n.activation_bundle != null && !bundleOrder.has(n.activation_bundle)) errors.push(`road_node ${n.stable_key}: unknown bundle ${n.activation_bundle}`);
  }
  for (const e of t.road_edges) {
    if (e.activation_bundle != null && !bundleOrder.has(e.activation_bundle)) errors.push(`road_edge ${e.stable_key}: unknown bundle ${e.activation_bundle}`);
    for (const k of [e.from_node, e.to_node]) {
      const n = nodes.get(k);
      if (!n) { errors.push(`road_edge ${e.stable_key}: unknown node ${k}`); continue; }
      if (stageOf(n.activation_bundle) > stageOf(e.activation_bundle)) errors.push(`road_edge ${e.stable_key} activates before its node ${k}`);
    }
    if (e.from_node === e.to_node) errors.push(`road_edge ${e.stable_key} is a self-loop`);
  }

  const perBundle = new Map<string, number>();
  for (const p of t.plots) {
    if (!districts.has(p.district_key)) errors.push(`plot ${p.stable_key}: unknown district ${p.district_key}`);
    if (!bundleOrder.has(p.activation_bundle)) errors.push(`plot ${p.stable_key}: unknown bundle ${p.activation_bundle}`);
    perBundle.set(p.activation_bundle, (perBundle.get(p.activation_bundle) ?? 0) + 1);
    const f = nodes.get(p.frontage_node);
    if (!f) errors.push(`plot ${p.stable_key}: unknown frontage node ${p.frontage_node}`);
    else if (stageOf(f.activation_bundle) > stageOf(p.activation_bundle)) errors.push(`plot ${p.stable_key}: frontage ${p.frontage_node} activates after the plot (no plot without active frontage)`);
    const cx = Math.floor(p.center.x_u / CHUNK_SIZE_U);
    const cy = Math.floor(p.center.y_u / CHUNK_SIZE_U);
    if (cx !== p.chunk_x || cy !== p.chunk_y) errors.push(`plot ${p.stable_key}: chunk (${p.chunk_x},${p.chunk_y}) does not contain center (expected ${cx},${cy})`);
  }
  for (const b of t.activation_bundles) {
    const n = perBundle.get(b.stable_key) ?? 0;
    if (n !== b.plot_count) errors.push(`bundle ${b.stable_key}: plot_count ${b.plot_count} but ${n} plots reference it`);
    if (n < 12 || n > 24) warnings.push(`bundle ${b.stable_key}: ${n} plots (Blueprint §7.2 expects 12–24)`);
  }
  for (const c of t.civic_anchors) if (!nodes.has(c.road_node)) errors.push(`civic_anchor ${c.stable_key}: unknown road node ${c.road_node}`);

  // Connectivity at every activation stage.
  const stages = [...new Set(orders)].sort((a, b) => a - b);
  for (const s of stages) {
    const activeNodes = t.road_nodes.filter((n) => stageOf(n.activation_bundle) <= s).map((n) => n.stable_key);
    const adj = new Map<string, string[]>();
    for (const e of t.road_edges) {
      if (stageOf(e.activation_bundle) > s) continue;
      (adj.get(e.from_node) ?? adj.set(e.from_node, []).get(e.from_node)!).push(e.to_node);
      (adj.get(e.to_node) ?? adj.set(e.to_node, []).get(e.to_node)!).push(e.from_node);
    }
    if (activeNodes.length === 0) continue;
    const seen = new Set([activeNodes[0]!]);
    const stack = [activeNodes[0]!];
    while (stack.length) for (const nb of adj.get(stack.pop()!) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
    const cut = activeNodes.filter((k) => !seen.has(k));
    if (cut.length) errors.push(`stage ${s}: active road graph is disconnected (${cut.length} unreachable nodes, e.g. ${cut.slice(0, 3).join(', ')})`);
  }

  const residential = t.plots.filter((p) => p.zone === 'residential' || p.zone === 'mixed').length;
  if (residential < 120) (opts.production ? errors : warnings).push(`only ${residential} first-home plots; production founding city needs ≥120 (Blueprint §7.2)`);
  return { errors, warnings };
}
