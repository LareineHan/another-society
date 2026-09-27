-- Another Society 002: contract alignment (EXPAND-ONLY)
--
-- Aligns the canonical v0.3 SQL schema (001) with the WorldTemplate v0.3 contract
-- and the account-deletion requirement. Every change is additive or a CHECK widening,
-- so it is safe under the expand/contract rule (Blueprint §54). See docs/adr/ADR-0002.
--
-- Problems fixed:
--   1. Template road node kind 'gate' was rejected by road_nodes CHECK.
--   2. Template edge kinds 'arterial'/'local' were rejected by road_edges CHECK.
--   3. road_nodes/road_edges had no activation_bundle, so bundle activation could not
--      know which public roads to enable before the bundle's plots (Blueprint §7.2).
--   4. Template civic_anchors had no table.
--   5. Template generator_version is the string "0.3"; cities.generator_version is integer.
--   6. Account deletion must revoke Sign in with Apple tokens (Blueprint §15), which requires
--      keeping the Apple refresh token (encrypted at rest).

BEGIN;

-- 1 + 2: widen kind checks ---------------------------------------------------
ALTER TABLE road_nodes DROP CONSTRAINT IF EXISTS road_nodes_node_kind_check;
ALTER TABLE road_nodes ADD CONSTRAINT road_nodes_node_kind_check
    CHECK (node_kind IN ('junction','frontage','civic','transit','gate'));

ALTER TABLE road_edges DROP CONSTRAINT IF EXISTS road_edges_edge_kind_check;
ALTER TABLE road_edges ADD CONSTRAINT road_edges_edge_kind_check
    CHECK (edge_kind IN ('street','lane','trail','bridge','transit','arterial','local'));

-- 3: activation bundles --------------------------------------------------------
-- NULL activation_bundle = permanent public skeleton (always active once imported).
ALTER TABLE road_nodes ADD COLUMN IF NOT EXISTS activation_bundle text;
ALTER TABLE road_edges ADD COLUMN IF NOT EXISTS activation_bundle text;
CREATE INDEX IF NOT EXISTS road_nodes_city_bundle_idx ON road_nodes(city_id, activation_bundle);
CREATE INDEX IF NOT EXISTS road_edges_city_bundle_idx ON road_edges(city_id, activation_bundle);
CREATE INDEX IF NOT EXISTS plots_city_bundle_idx ON plots(city_id, activation_bundle);

CREATE TABLE IF NOT EXISTS city_activation_bundles (
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    stable_key          text NOT NULL,
    activation_order    integer NOT NULL CHECK (activation_order >= 0),
    plot_count          integer NOT NULL CHECK (plot_count > 0),
    initial_active      boolean NOT NULL DEFAULT false,
    status              text NOT NULL DEFAULT 'latent'
                        CHECK (status IN ('latent','active')),
    activated_at        timestamptz,
    activation_reason   text,
    PRIMARY KEY (city_id, stable_key),
    UNIQUE (city_id, activation_order)
);

-- Monotonic counter bumped on every activation so clients can cheaply detect map changes.
ALTER TABLE cities ADD COLUMN IF NOT EXISTS activation_revision bigint NOT NULL DEFAULT 1;

-- 4: civic anchors -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS civic_anchors (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    stable_template_key text NOT NULL,
    kind                text NOT NULL,
    x_u                 integer NOT NULL,
    y_u                 integer NOT NULL,
    road_node_id        uuid NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    UNIQUE (city_id, stable_template_key)
);

-- 5: template provenance ------------------------------------------------------
ALTER TABLE cities ADD COLUMN IF NOT EXISTS template_generator_version text;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS theme text;

CREATE TABLE IF NOT EXISTS world_template_imports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    template_id         text NOT NULL,
    generator_version   text NOT NULL,
    template_sha256     text NOT NULL,
    plots_added         integer NOT NULL DEFAULT 0,
    road_nodes_added    integer NOT NULL DEFAULT 0,
    road_edges_added    integer NOT NULL DEFAULT 0,
    imported_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS world_template_imports_city_idx ON world_template_imports(city_id, imported_at DESC);

-- 6: provider token for revocation on account deletion -------------------------
-- AES-GCM ciphertext (iv || ciphertext) produced by the API worker; key lives in Worker secrets.
ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS provider_refresh_token_enc bytea;
ALTER TABLE auth_identities ADD COLUMN IF NOT EXISTS provider_token_updated_at timestamptz;

COMMIT;
