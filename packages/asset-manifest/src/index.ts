// Worker-safe: data + lookups only. Schema validation (ajv, uses eval) lives in ./validate.ts (Node/CI only).
import coreDev from '../packs/core-dev.v1.json';

export interface AssetEntry {
  asset_id: string;
  kind: 'mini_part' | 'furniture' | 'decor' | 'plant' | 'structure' | 'terrain' | 'road' | 'gift' | 'effect';
  sprite_key: string;
  anchor: { x: number; y: number };
  footprint_u: { w: number; d: number };
  render_layer: number;
  rotations: number[];
  gift_eligible: boolean;
  content_rating: 'general' | 'teen';
  sha256?: string;
  animation_manifest?: string | null;
}

export interface AssetPack {
  pack_id: string;
  pack_version: string;
  assets: AssetEntry[];
}

export const CORE_DEV_PACK = coreDev as AssetPack;
export const ASSET_PACKS: AssetPack[] = [CORE_DEV_PACK];

const index = new Map<string, { pack: AssetPack; asset: AssetEntry }>();
for (const pack of ASSET_PACKS) for (const asset of pack.assets) index.set(asset.asset_id, { pack, asset });

export function findAsset(assetId: string): { pack: AssetPack; asset: AssetEntry } | undefined {
  return index.get(assetId);
}

/**
 * Placements persist quarter turns (rotation_q 0..3, SQL). The manifest lists allowed
 * rotations in degrees (8-way capable). A quarter turn is valid only if the asset
 * lists rotation_q * 90.
 */
export function rotationAllowed(asset: AssetEntry, rotationQ: number): boolean {
  return Number.isInteger(rotationQ) && rotationQ >= 0 && rotationQ <= 3 && asset.rotations.includes(rotationQ * 90);
}

/** Manifest uses general|teen; SQL item_definitions uses general|restricted. */
export function toDbContentRating(r: AssetEntry['content_rating']): 'general' | 'restricted' {
  return r === 'general' ? 'general' : 'restricted';
}
