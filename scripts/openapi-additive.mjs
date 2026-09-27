// One-off: additive v0.3.1 contract changes (no removals, no type changes). Kept for provenance.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';

const file = 'packages/api-contract/openapi.yaml';
const spec = parse(readFileSync(file, 'utf8'));
const S = spec.components.schemas;
const uuid = { type: 'string', format: 'uuid' };
const int = { type: 'integer' };
const addProps = (name, props) => Object.assign(S[name].properties ?? (S[name].allOf ? S[name].allOf[1].properties : (S[name].properties = {})), props);

spec.info.version = '0.3.1';
spec.info.description += '\nv0.3.1 is additive only (new optional response fields, three read endpoints). ' +
  'Every mutation that can move ownership/money/presence takes Idempotency-Key; a replay returns the original body with header `Idempotent-Replayed: true`. ' +
  'Stable error codes: unauthorized, forbidden, not_found, validation_error, conflict, revision_conflict, idempotency_key_required, idempotency_mismatch, ' +
  'plot_unavailable, reservation_invalid, already_has_home, insufficient_funds, stay_not_allowed, stay_capacity_full, not_staying, gift_not_allowed, rate_limited, account_inactive, internal_error.\n';

addProps('MeResponse', { active_stay: { type: 'object', properties: { id: uuid, space_id: uuid, host_property_id: uuid, started_at: { type: 'string', format: 'date-time' } } } });
addProps('Resident', { primary_home: { type: 'object', properties: { property_id: uuid, space_id: uuid, plot_id: uuid, city_id: uuid } } });
Object.assign(S.WorldBootstrap.properties.cities.items.properties, { activation_revision: { type: 'integer', format: 'int64' }, theme: { type: ['string', 'null'] } });
S.WorldBootstrap.properties.coordinate_system = { type: 'object', properties: { units_per_tile: int, chunk_size_u: int } };
addProps('PlotSummary', {
  chunk_x: int, chunk_y: int,
  labels: { type: 'array', description: 'Quiet map facts, never a recommendation score.', items: { type: 'string', enum: ['closer_to_town', 'near_park', 'near_neighbors', 'quieter_edge', 'forest_side'] } },
  reserved_by_me: { type: 'boolean' },
});
addProps('PropertyPreview', { structure_x_u: int, structure_y_u: int, structure_rot_q: { type: 'integer', minimum: 0, maximum: 3 } });
addProps('Property', {
  property_type: { type: 'string', enum: ['home', 'studio', 'shop', 'other'] },
  owner: { type: 'object', properties: { id: uuid, display_name: { type: 'string' } } },
  space_ids: { type: 'array', items: uuid },
  viewer: { type: 'object', properties: { is_owner: { type: 'boolean' }, can_enter: { type: 'boolean' }, can_stay: { type: 'boolean' } } },
  owner_away: { type: 'boolean', description: 'Owner-only: true while the owner has an active foreign Stay.' },
});
S.Stayer = { type: 'object', required: ['resident_id', 'display_name', 'mini_definition', 'started_at'], properties: {
  resident_id: uuid, display_name: { type: 'string' }, mini_definition: { type: 'object', additionalProperties: true }, started_at: { type: 'string', format: 'date-time' } } };
S.PendingGiftPreview = { type: 'object', properties: { id: uuid, item_instance_id: uuid, drop_x_u: int, drop_y_u: int, asset_id: { type: 'string' }, definition_key: { type: 'string' } } };
addProps('Space', {
  space_kind: { type: 'string' },
  bounds: { type: 'object', properties: { minX: int, minY: int, maxX: int, maxY: int } },
  stayers: { type: 'array', description: 'Active Stays (public presence). Residents in a block relationship with the viewer are omitted.', items: { $ref: '#/components/schemas/Stayer' } },
  pending_gifts: { type: 'array', description: 'Owner only.', items: { $ref: '#/components/schemas/PendingGiftPreview' } },
});
S.Placement.allOf[1].properties.asset_id = { type: 'string' };
S.Placement.allOf[1].properties.definition_key = { type: 'string' };
const itemExtras = { definition_key: { type: 'string' }, asset_id: { type: 'string' }, category: { type: 'string' }, gift_eligible: { type: 'boolean' } };
addProps('ItemInstance', itemExtras);
addProps('StoreListing', { ...itemExtras });
addProps('Gift', {
  resolved_at: { type: 'string', format: 'date-time' },
  giver: { type: 'object', description: 'Intentional identity reveal. linkable=false after block or deletion.', properties: { display_name: { type: 'string' }, linkable: { type: 'boolean' } } },
  asset_id: { type: 'string' }, definition_key: { type: 'string' },
});

const visit = spec.paths['/properties/{propertyId}/visit'].post;
visit.description = 'Transient, non-live observation. Call on entering and again after the dwell threshold (e.g. on leaving); the server measures dwell and qualifies at most one visit per visitor/property/day. The owner only ever sees anonymous aggregates.';
visit.responses['200'].content['application/json'].schema.properties.visit = { type: 'object', properties: { qualified: { type: 'boolean' } } };
visit.responses['404'] = { $ref: '#/components/responses/NotFound' };

spec.paths['/auth/logout'].post.parameters = [{ in: 'query', name: 'all', schema: { type: 'boolean' }, description: 'Revoke every session of this account (all devices).' }];

S.RoadGraph = { type: 'object', required: ['city_id', 'activation_revision', 'nodes', 'edges', 'civic_anchors'], properties: {
  city_id: uuid, activation_revision: { type: 'integer', format: 'int64' },
  nodes: { type: 'array', items: { type: 'object', required: ['id', 'x_u', 'y_u', 'node_kind'], properties: { id: uuid, x_u: int, y_u: int, node_kind: { type: 'string' } } } },
  edges: { type: 'array', items: { type: 'object', required: ['id', 'from_node_id', 'to_node_id', 'weight_milli'], properties: {
    id: uuid, from_node_id: uuid, to_node_id: uuid, edge_kind: { type: 'string' }, weight_milli: int,
    geometry_points: { type: 'array', items: { type: 'object', properties: { x_u: int, y_u: int } } } } } },
  civic_anchors: { type: 'array', items: { type: 'object', properties: { id: uuid, kind: { type: 'string' }, x_u: int, y_u: int, road_node_id: uuid } } },
} };
spec.paths['/cities/{cityId}/roads'] = { get: {
  tags: ['World'], operationId: 'getCityRoads',
  description: 'Active public road graph and civic anchors for client-side routing (A*). ETag is keyed to the city activation revision; send If-None-Match to get 304.',
  parameters: [{ $ref: '#/components/parameters/CityId' }, { in: 'header', name: 'If-None-Match', schema: { type: 'string' } }],
  responses: { '200': { description: 'Active road graph.', content: { 'application/json': { schema: { $ref: '#/components/schemas/RoadGraph' } } } },
    '304': { description: 'Unchanged since the given ETag.' }, '404': { $ref: '#/components/responses/NotFound' } },
} };
spec.paths['/wander'] = { get: {
  tags: ['Social'], operationId: 'wander',
  description: 'A few publicly enterable homes, nearest-first with jitter. Not a ranking; never includes the caller, blocked residents, or closed homes.',
  parameters: [
    { in: 'query', name: 'city_id', required: true, schema: uuid },
    { in: 'query', name: 'x_u', schema: int }, { in: 'query', name: 'y_u', schema: int },
    { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 } },
  ],
  responses: { '200': { description: 'Wander candidates.', content: { 'application/json': { schema: { type: 'object', required: ['properties'], properties: {
    properties: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/PropertyPreview' }, { type: 'object', properties: { center_x_u: int, center_y_u: int } }] } } } } } } },
    '422': { $ref: '#/components/responses/ValidationError' } },
} };
spec.paths['/properties/{propertyId}/visits/summary'] = { get: {
  tags: ['Social'], operationId: 'getVisitSummary',
  description: 'Owner-only anonymous visit aggregate for the last 7 days, in soft-language bands. Exact counts appear only when the visits.exact_counts experiment flag is on. Never exposes visitor identity.',
  parameters: [{ $ref: '#/components/parameters/PropertyId' }],
  responses: { '200': { description: 'Soft-language aggregate.', content: { 'application/json': { schema: { type: 'object', required: ['property_id', 'band', 'copy', 'days'], properties: {
    property_id: uuid, window_days: int, band: { type: 'string', enum: ['none', 'someone', 'a_few', 'busy'] }, copy: { type: 'string' }, count: int,
    days: { type: 'array', items: { type: 'object', properties: { day: { type: 'string', format: 'date' }, band: { type: 'string' }, count: int } } } } } } } },
    '404': { $ref: '#/components/responses/NotFound' } },
} };
spec.components.parameters.IdempotencyKey.description = 'Scoped to (user, operation). Same key + same request replays the stored response; same key + different request is 409 idempotency_mismatch.';

writeFileSync(file, stringify(spec, { indentSeq: false, lineWidth: 120 }));
console.log('ok');
