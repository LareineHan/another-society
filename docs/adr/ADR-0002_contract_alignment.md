# ADR-0002: Contract alignment for the v0.3 baseline

**Status:** Accepted. Implementation detail under ADR-0001; changes none of its 16 decisions.

## Measured problem

Implementing the v0.3 pack exactly as delivered failed in six places where the SQL schema, the
WorldTemplate contract, the asset manifest and the Blueprint disagreed:

| # | Conflict | Effect |
|---|----------|--------|
| 1 | Template `node_kind: gate`; SQL CHECK allows `junction, frontage, civic, transit` | Importer rejects the founding-city fixture |
| 2 | Template `edge_kind: arterial, local, trail`; SQL CHECK allows `street, lane, trail, bridge, transit` | Same |
| 3 | `road_nodes` / `road_edges` have no `activation_bundle` column | Activation cannot enable a bundle's roads before its plots (Blueprint §7.2) |
| 4 | Template `civic_anchors` has no table | General store, market hall and park positions are lost |
| 5 | Template `generator_version: "0.3"` (string); `cities.generator_version` is integer | Provenance lost or import fails |
| 6 | Account deletion must revoke Sign in with Apple tokens (§15); no column holds the Apple refresh token | Deletion cannot be compliant |

Two smaller gaps were resolved in code, not schema:

- Asset manifest rotations are degrees (8-way); placements store `rotation_q` 0..3. A quarter turn is valid only if the asset lists `rotation_q * 90`.
- Manifest `content_rating` is `general | teen`; SQL is `general | restricted`. Mapped `teen -> restricted`; v0.1 ships `general` only.

## Decision

Migration `002_contract_alignment.sql`, expand-only:

1. and 2. Widen both CHECK constraints; the importer stores template vocabulary verbatim.
3. Add nullable `activation_bundle` to `road_nodes` and `road_edges` (NULL = permanent skeleton) and a
   `city_activation_bundles` table whose row is the activation lock and audit record. Add
   `cities.activation_revision` so clients can cache the road graph by ETag.
4. Add `civic_anchors`.
5. Keep `cities.generator_version` (integer, `major*1000+minor`) and add `template_generator_version text`,
   `theme`, and a `world_template_imports` log with the template hash.
6. Add `auth_identities.provider_refresh_token_enc` (AES-256-GCM, key in Worker secrets).

## Alternatives considered

- Map `gate -> transit`, `arterial -> street`, `local -> lane` in the importer: loses template meaning and
  makes future templates lossy. Rejected.
- Infer bundle membership from stable-key prefixes (`b0_n00`): fragile naming contract. Rejected.
- Edit 001 in place: it may already be applied somewhere; forward-only migrations are the rule. Rejected.

## Consequences

- Migration cost: none (all additive, nullable or defaulted). Backward compatible with 001-era code.
- Cost impact: negligible (three small tables, two nullable columns).
- Abuse/safety impact: positive (deletion can revoke Apple tokens; token is encrypted at rest).
- API: v0.3.1 is a strict superset of v0.3.0 (verified mechanically: no removed or changed keys).
