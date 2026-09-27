export interface Point { x_u: number; y_u: number }

export interface WorldTemplate {
  template_id: string;
  generator_version: '0.3';
  coordinate_system: { units_per_tile: 1000; chunk_size_u: 32000 };
  city: { stable_key: string; name: string; theme: string };
  districts: { stable_key: string; name: string; activation_order: number }[];
  activation_bundles: { stable_key: string; activation_order: number; initial_active: boolean; plot_count: number }[];
  road_nodes: { stable_key: string; x_u: number; y_u: number; node_kind: 'junction' | 'frontage' | 'civic' | 'gate'; activation_bundle?: string | null }[];
  road_edges: { stable_key: string; from_node: string; to_node: string; edge_kind: 'arterial' | 'local' | 'trail'; weight_u: number; activation_bundle?: string | null; polyline: Point[] }[];
  plots: {
    stable_key: string;
    district_key: string;
    activation_bundle: string;
    activation_order: number;
    chunk_x: number;
    chunk_y: number;
    center: Point;
    terrain: string;
    zone: 'residential' | 'mixed' | 'commercial' | 'civic';
    frontage_node: string;
    build_bounds: Point[];
    scenic_tags: string[];
  }[];
  civic_anchors: { stable_key: string; kind: string; position: Point; road_node: string }[];
}

/** "0.3" -> 3, "1.2" -> 1002. cities.generator_version is an integer column; the text form is kept too. */
export function generatorVersionToInt(v: string): number {
  const m = /^(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Unsupported generator_version "${v}"`);
  return Number(m[1]) * 1000 + Number(m[2]);
}
