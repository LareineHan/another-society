import { DomainError } from './errors';

/**
 * v0.1 Mini definition: assembled only from approved parts (Blueprint §33).
 * DEV_PLACEHOLDER part catalogs until the Mini art set exists; keys are stable asset IDs.
 */
export const MINI_PARTS = {
  body: ['mini.body.a', 'mini.body.b', 'mini.body.c'],
  skin: ['mini.skin.1', 'mini.skin.2', 'mini.skin.3', 'mini.skin.4', 'mini.skin.5', 'mini.skin.6'],
  hair: ['mini.hair.none', 'mini.hair.short', 'mini.hair.bob', 'mini.hair.long', 'mini.hair.bun', 'mini.hair.curly'],
  hair_color: ['mini.haircolor.black', 'mini.haircolor.brown', 'mini.haircolor.blond', 'mini.haircolor.red', 'mini.haircolor.grey', 'mini.haircolor.blue'],
  outfit: ['mini.outfit.sweater', 'mini.outfit.coat', 'mini.outfit.overalls', 'mini.outfit.dress', 'mini.outfit.hoodie'],
  outfit_color: ['mini.palette.oat', 'mini.palette.moss', 'mini.palette.clay', 'mini.palette.sky', 'mini.palette.plum', 'mini.palette.ink'],
  accessory: ['mini.acc.none', 'mini.acc.glasses', 'mini.acc.scarf', 'mini.acc.hat', 'mini.acc.bag'],
} as const;

export type MiniSlot = keyof typeof MINI_PARTS;
export type MiniDefinition = { version: 1 } & { [K in MiniSlot]: (typeof MINI_PARTS)[K][number] };

export const DEFAULT_MINI: MiniDefinition = {
  version: 1,
  body: 'mini.body.a',
  skin: 'mini.skin.3',
  hair: 'mini.hair.short',
  hair_color: 'mini.haircolor.brown',
  outfit: 'mini.outfit.sweater',
  outfit_color: 'mini.palette.oat',
  accessory: 'mini.acc.none',
};

export function validateMiniDefinition(input: unknown): MiniDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DomainError('validation_error', 'Mini definition must be an object.', { field: 'definition' });
  }
  const obj = input as Record<string, unknown>;
  const allowedKeys = new Set<string>(['version', ...Object.keys(MINI_PARTS)]);
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.has(k)) throw new DomainError('validation_error', `Unknown Mini slot "${k}".`, { field: `definition.${k}` });
  }
  if (obj.version !== undefined && obj.version !== 1) {
    throw new DomainError('validation_error', 'Unsupported Mini definition version.', { field: 'definition.version' });
  }
  const out: Record<string, unknown> = { version: 1 };
  for (const slot of Object.keys(MINI_PARTS) as MiniSlot[]) {
    const v = obj[slot] ?? DEFAULT_MINI[slot];
    if (typeof v !== 'string' || !(MINI_PARTS[slot] as readonly string[]).includes(v)) {
      throw new DomainError('validation_error', `"${String(v)}" is not an approved ${slot} part.`, { field: `definition.${slot}` });
    }
    out[slot] = v;
  }
  return out as MiniDefinition;
}
