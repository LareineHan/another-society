// Node/CI only (ajv compiles with eval, which Workers forbid).
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../asset-manifest.schema.json';
import type { AssetPack } from './index';

export function validateAssetPack(pack: unknown): { ok: true; pack: AssetPack } | { ok: false; errors: string[] } {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(pack)) {
    return { ok: false, errors: (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
  }
  const p = pack as unknown as AssetPack;
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const a of p.assets) {
    if (seen.has(a.asset_id)) errors.push(`duplicate asset_id ${a.asset_id}`);
    seen.add(a.asset_id);
  }
  return errors.length ? { ok: false, errors } : { ok: true, pack: p };
}
