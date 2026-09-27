// Node/test only: validates real responses against the checked-in OpenAPI contract.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const specPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url));

type Spec = { paths: Record<string, Record<string, { responses: Record<string, unknown> }>>; components: Record<string, unknown> };

export function loadSpec(): Spec {
  return parse(readFileSync(specPath, 'utf8')) as Spec;
}

const esc = (s: string) => encodeURIComponent(s.replace(/~/g, '~0').replace(/\//g, '~1'));

export function createResponseValidator() {
  const spec = loadSpec();
  const ajv = new Ajv2020({ strict: false, allErrors: true, formats: { int64: true } });
  addFormats(ajv);
  ajv.addSchema(spec as object, 'openapi.json');
  const templates = Object.keys(spec.paths).map((p) => ({
    template: p,
    re: new RegExp('^' + p.replace(/\{[^}]+\}/g, '[^/]+') + '$'),
  }));
  const cache = new Map<string, ReturnType<typeof ajv.compile> | null>();

  function schemaRef(template: string, method: string, status: number): string | null {
    const op = spec.paths[template]?.[method];
    if (!op) return null;
    let resp = op.responses[String(status)] as Record<string, unknown> | undefined;
    let base = `openapi.json#/paths/${esc(template)}/${method}/responses/${status}`;
    if (!resp) return null;
    if (typeof resp.$ref === 'string') {
      const name = (resp.$ref as string).split('/').pop()!;
      resp = (spec.components.responses as Record<string, Record<string, unknown>>)[name];
      base = `openapi.json#/components/responses/${esc(name)}`;
    }
    const content = resp?.content as Record<string, unknown> | undefined;
    if (!content?.['application/json']) return null;
    return `${base}/content/${esc('application/json')}/schema`;
  }

  return {
    /** Returns null when the operation/status has no JSON schema in the contract, else a list of errors (empty = valid). */
    validate(method: string, path: string, status: number, body: unknown): { operation: string; errors: string[] } | { operation: null } {
      const p = path.replace(/^\/v1/, '').split('?')[0]!;
      const match = templates.find((t) => t.re.test(p));
      if (!match) return { operation: null };
      const m = method.toLowerCase();
      if (!spec.paths[match.template]?.[m]) return { operation: null };
      const key = `${match.template} ${m} ${status}`;
      let fn = cache.get(key);
      if (fn === undefined) {
        const ref = schemaRef(match.template, m, status);
        fn = ref ? ajv.compile({ $ref: ref }) : null;
        cache.set(key, fn);
      }
      if (!fn) return { operation: `${m.toUpperCase()} ${match.template} ${status} (no schema)`, errors: status >= 200 && status < 300 && status !== 204 ? [`status ${status} is not documented`] : [] };
      const ok = fn(body);
      return { operation: key, errors: ok ? [] : (fn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) };
    },
    spec,
  };
}
