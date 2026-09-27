/** Canonical fixed-point world coordinates (Blueprint §4.6). Never floats in persisted state. */
export const UNITS_PER_TILE = 1000;
export const CHUNK_TILES = 32;
export const CHUNK_SIZE_U = UNITS_PER_TILE * CHUNK_TILES; // 32,000

/** Chunk index for a unit coordinate. Uses floor division so negatives map correctly (-1 -> chunk -1). */
export const chunkOf = (u: number): number => Math.floor(u / CHUNK_SIZE_U);

export const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const inRect = (x: number, y: number, r: Rect): boolean =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

/** Max chunks a single /chunks window may request (OpenAPI ChunkSummary maxItems). */
export const MAX_CHUNK_WINDOW = 100;

export const chunkWindowSize = (r: Rect): number => (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
