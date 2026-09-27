import SwaggerParser from '@apidevtools/swagger-parser';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../openapi.yaml', import.meta.url));
const api = await SwaggerParser.validate(file);
const ops = Object.values(api.paths ?? {}).reduce((n, p) => n + Object.keys(p ?? {}).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length, 0);
console.log(`ok: ${api.info.title} ${api.info.version} — ${ops} operations`);
