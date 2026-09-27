// Node/CI only (ajv uses eval).
import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../world-template.schema.json';
import type { WorldTemplate } from './types';
import { checkTemplateSemantics, type SemanticReport } from './semantic';

export function validateTemplate(input: unknown, opts: { production?: boolean } = {}): SemanticReport & { template?: WorldTemplate } {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(input)) {
    return { errors: (validate.errors ?? []).map((e) => `schema ${e.instancePath || '/'} ${e.message}`), warnings: [] };
  }
  const t = input as unknown as WorldTemplate;
  return { ...checkTemplateSemantics(t, opts), template: t };
}
