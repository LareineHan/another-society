-- Another Society v0.3
-- Canonical PostgreSQL baseline schema
-- Target: Neon Postgres; designed to remain portable PostgreSQL.
-- IMPORTANT: critical mutations still require application-level authorization,
-- deterministic row locking, idempotency handling, and transaction boundaries.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Accounts / identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','deleting','deleted')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz
);

CREATE TABLE auth_identities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider            text NOT NULL CHECK (provider IN ('apple','google','other')),
    provider_subject    text NOT NULL,
    provider_email      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    last_used_at        timestamptz,
    UNIQUE (provider, provider_subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities(user_id);

CREATE TABLE auth_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  bytea NOT NULL UNIQUE,
    device_label        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    last_used_at        timestamptz
);
CREATE INDEX auth_sessions_user_active_idx
    ON auth_sessions(user_id, expires_at)
    WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- World hierarchy
-- ---------------------------------------------------------------------------

CREATE TABLE worlds (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text NOT NULL UNIQUE,
    display_name        text NOT NULL,
    rules_version       integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE regions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id            uuid NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
    code                text NOT NULL,
    display_name        text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (world_id, code)
);

CREATE TABLE cities (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id           uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    code                text NOT NULL,
    display_name        text NOT NULL,
    template_id         text NOT NULL,
    generator_version   integer NOT NULL,
    status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('planned','open','closed_to_new_residents','archived')),
    soft_property_cap   integer NOT NULL DEFAULT 1500 CHECK (soft_property_cap > 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (region_id, code)
);

CREATE TABLE districts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    code                text NOT NULL,
    display_name        text,
    activation_order    integer NOT NULL,
    status              text NOT NULL DEFAULT 'latent'
                        CHECK (status IN ('latent','active','retired')),
    activated_at        timestamptz,
    UNIQUE (city_id, code)
);
CREATE INDEX districts_city_status_idx ON districts(city_id, status, activation_order);

CREATE TABLE chunks (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district_id         uuid REFERENCES districts(id) ON DELETE RESTRICT,
    chunk_x             integer NOT NULL,
    chunk_y             integer NOT NULL,
    revision            bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (city_id, chunk_x, chunk_y)
);

CREATE TABLE road_nodes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district_id         uuid REFERENCES districts(id) ON DELETE RESTRICT,
    x_u                 integer NOT NULL,
    y_u                 integer NOT NULL,
    node_kind           text NOT NULL DEFAULT 'junction'
                        CHECK (node_kind IN ('junction','frontage','civic','transit')),
    active              boolean NOT NULL DEFAULT false,
    stable_template_key text NOT NULL,
    UNIQUE (city_id, stable_template_key)
);
CREATE INDEX road_nodes_city_active_idx ON road_nodes(city_id, active);

CREATE TABLE road_edges (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district_id         uuid REFERENCES districts(id) ON DELETE RESTRICT,
    from_node_id        uuid NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    to_node_id          uuid NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    edge_kind           text NOT NULL DEFAULT 'street'
                        CHECK (edge_kind IN ('street','lane','trail','bridge','transit')),
    weight_milli        integer NOT NULL CHECK (weight_milli > 0),
    geometry_points     jsonb NOT NULL DEFAULT '[]'::jsonb,
    active              boolean NOT NULL DEFAULT false,
    stable_template_key text NOT NULL,
    UNIQUE (city_id, stable_template_key),
    CHECK (from_node_id <> to_node_id)
);
CREATE INDEX road_edges_city_active_idx ON road_edges(city_id, active);
CREATE INDEX road_edges_from_idx ON road_edges(from_node_id) WHERE active;
CREATE INDEX road_edges_to_idx ON road_edges(to_node_id) WHERE active;

CREATE TABLE plots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    district_id         uuid NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
    chunk_id            uuid NOT NULL REFERENCES chunks(id) ON DELETE RESTRICT,
    stable_template_key text NOT NULL,
    center_x_u          integer NOT NULL,
    center_y_u          integer NOT NULL,
    terrain_type        text NOT NULL,
    zone_type           text NOT NULL DEFAULT 'residential',
    scenic_tags         text[] NOT NULL DEFAULT '{}',
    frontage_node_id    uuid NOT NULL REFERENCES road_nodes(id) ON DELETE RESTRICT,
    build_bounds        jsonb NOT NULL,
    activation_bundle   text NOT NULL,
    activation_order    integer NOT NULL,
    status              text NOT NULL DEFAULT 'latent'
                        CHECK (status IN ('latent','vacant','reserved','occupied','retired')),
    activated_at        timestamptz,
    revision            bigint NOT NULL DEFAULT 1,
    UNIQUE (city_id, stable_template_key)
);
CREATE INDEX plots_city_status_idx ON plots(city_id, status);
CREATE INDEX plots_city_district_status_idx ON plots(city_id, district_id, status);
CREATE INDEX plots_chunk_status_idx ON plots(chunk_id, status);

CREATE TABLE plot_reservations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id             uuid NOT NULL REFERENCES plots(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    claimed_at          timestamptz,
    cancelled_at        timestamptz
);
CREATE UNIQUE INDEX plot_reservations_one_live_per_plot_idx
    ON plot_reservations(plot_id)
    WHERE claimed_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX plot_reservations_one_live_per_user_idx
    ON plot_reservations(user_id)
    WHERE claimed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX plot_reservations_expiry_idx
    ON plot_reservations(expires_at)
    WHERE claimed_at IS NULL AND cancelled_at IS NULL;

-- ---------------------------------------------------------------------------
-- Resident identity
-- ---------------------------------------------------------------------------

CREATE TABLE residents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    world_id            uuid NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
    display_name        text NOT NULL,
    display_name_norm   text NOT NULL,
    public_tag          text NOT NULL UNIQUE,
    mini_definition     jsonb NOT NULL DEFAULT '{}'::jsonb,
    onboarding_state    text NOT NULL DEFAULT 'choosing_plot'
                        CHECK (onboarding_state IN ('choosing_plot','claimed','complete')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (char_length(display_name) BETWEEN 1 AND 64)
);
CREATE INDEX residents_world_idx ON residents(world_id);
CREATE INDEX residents_display_name_norm_idx ON residents(display_name_norm);

CREATE TABLE companion_minis (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_resident_id   uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    definition          jsonb NOT NULL,
    private_label       text,
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','archived')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companion_minis_owner_idx ON companion_minis(owner_resident_id, status);

-- ---------------------------------------------------------------------------
-- Property / spaces / layout
-- ---------------------------------------------------------------------------

CREATE TABLE properties (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    plot_id             uuid NOT NULL REFERENCES plots(id) ON DELETE RESTRICT,
    owner_resident_id   uuid NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
    property_type       text NOT NULL CHECK (property_type IN ('home','studio','shop','other')),
    structure_asset_id  text NOT NULL,
    structure_x_u       integer NOT NULL DEFAULT 0,
    structure_y_u       integer NOT NULL DEFAULT 0,
    structure_rot_q     smallint NOT NULL DEFAULT 0 CHECK (structure_rot_q BETWEEN 0 AND 3),
    access_mode         text NOT NULL DEFAULT 'open' CHECK (access_mode IN ('open','closed')),
    away_access_mode    text NOT NULL DEFAULT 'open' CHECK (away_access_mode IN ('open','closed')),
    allow_stays         boolean NOT NULL DEFAULT true,
    stay_capacity       smallint NOT NULL DEFAULT 4 CHECK (stay_capacity BETWEEN 0 AND 20),
    is_primary_home     boolean NOT NULL DEFAULT false,
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','hidden','archived')),
    revision            bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX properties_one_active_per_plot_idx
    ON properties(plot_id)
    WHERE status = 'active';
CREATE INDEX properties_owner_idx ON properties(owner_resident_id, status);
CREATE UNIQUE INDEX properties_one_primary_home_idx
    ON properties(owner_resident_id)
    WHERE is_primary_home = true AND status = 'active';

CREATE TABLE spaces (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    space_kind          text NOT NULL DEFAULT 'main'
                        CHECK (space_kind IN ('main','interior','yard','shop_floor','studio_floor')),
    asset_shell_id      text,
    visitor_capacity    smallint NOT NULL DEFAULT 8 CHECK (visitor_capacity BETWEEN 1 AND 50),
    layout_revision     bigint NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spaces_property_idx ON spaces(property_id);

-- ---------------------------------------------------------------------------
-- Items / inventory
-- ---------------------------------------------------------------------------

CREATE TABLE item_definitions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_key      text NOT NULL UNIQUE,
    creator_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
    source_kind         text NOT NULL DEFAULT 'system'
                        CHECK (source_kind IN ('system','resident','city')),
    category            text NOT NULL,
    recipe_family       text,
    definition_version  integer NOT NULL DEFAULT 1,
    visual_definition   jsonb NOT NULL,
    content_hash        text,
    gift_eligible       boolean NOT NULL DEFAULT false,
    tradable            boolean NOT NULL DEFAULT false,
    content_rating      text NOT NULL DEFAULT 'general'
                        CHECK (content_rating IN ('general','restricted')),
    moderation_status   text NOT NULL DEFAULT 'approved'
                        CHECK (moderation_status IN ('pending','approved','rejected','hidden')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_definitions_category_idx ON item_definitions(category, moderation_status);
CREATE INDEX item_definitions_creator_idx ON item_definitions(creator_resident_id);
CREATE INDEX item_definitions_hash_idx ON item_definitions(content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE item_instances (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    definition_id       uuid NOT NULL REFERENCES item_definitions(id) ON DELETE RESTRICT,
    owner_resident_id   uuid REFERENCES residents(id) ON DELETE RESTRICT,
    owner_city_id       uuid REFERENCES cities(id) ON DELETE RESTRICT,
    owner_system_code   text,
    state               text NOT NULL DEFAULT 'inventory'
                        CHECK (state IN ('inventory','placed','pending_placement','listed','procurement','retired')),
    provenance          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (CASE WHEN owner_resident_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN owner_city_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN owner_system_code IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);
CREATE INDEX item_instances_resident_idx ON item_instances(owner_resident_id, state) WHERE owner_resident_id IS NOT NULL;
CREATE INDEX item_instances_city_idx ON item_instances(owner_city_id, state) WHERE owner_city_id IS NOT NULL;

CREATE TABLE placements (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id            uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    item_instance_id    uuid NOT NULL REFERENCES item_instances(id) ON DELETE RESTRICT,
    x_u                 integer NOT NULL,
    y_u                 integer NOT NULL,
    rotation_q          smallint NOT NULL DEFAULT 0 CHECK (rotation_q BETWEEN 0 AND 3),
    scale_milli         integer NOT NULL DEFAULT 1000 CHECK (scale_milli BETWEEN 500 AND 2000),
    layer               integer NOT NULL DEFAULT 0,
    placed_at           timestamptz NOT NULL DEFAULT now(),
    removed_at          timestamptz
);
CREATE UNIQUE INDEX placements_one_active_per_item_idx
    ON placements(item_instance_id)
    WHERE removed_at IS NULL;
CREATE INDEX placements_space_active_idx ON placements(space_id) WHERE removed_at IS NULL;

CREATE TABLE material_balances (
    resident_id         uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    material_key        text NOT NULL,
    quantity            bigint NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (resident_id, material_key)
);

-- ---------------------------------------------------------------------------
-- Presence / social
-- ---------------------------------------------------------------------------

CREATE TABLE presence (
    resident_id         uuid PRIMARY KEY REFERENCES residents(id) ON DELETE CASCADE,
    state               text NOT NULL DEFAULT 'home'
                        CHECK (state IN ('home','traveling','visiting','staying','offline')),
    current_city_id     uuid REFERENCES cities(id) ON DELETE SET NULL,
    current_property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
    current_space_id    uuid REFERENCES spaces(id) ON DELETE SET NULL,
    destination_id      uuid,
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX presence_property_idx ON presence(current_property_id) WHERE current_property_id IS NOT NULL;
CREATE INDEX presence_space_idx ON presence(current_space_id) WHERE current_space_id IS NOT NULL;

CREATE TABLE stays (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id         uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    host_property_id    uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    space_id            uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    started_at          timestamptz NOT NULL DEFAULT now(),
    ended_at            timestamptz,
    end_reason          text
);
CREATE UNIQUE INDEX stays_one_active_per_resident_idx
    ON stays(resident_id)
    WHERE ended_at IS NULL;
CREATE INDEX stays_active_space_idx ON stays(space_id, started_at) WHERE ended_at IS NULL;

CREATE TABLE visit_receipts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    visitor_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    occurred_on         date NOT NULL DEFAULT CURRENT_DATE,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    qualified_at        timestamptz,
    purge_after         timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    UNIQUE (property_id, visitor_resident_id, occurred_on)
);
CREATE INDEX visit_receipts_property_day_idx ON visit_receipts(property_id, occurred_on);
CREATE INDEX visit_receipts_purge_idx ON visit_receipts(purge_after);

CREATE TABLE property_visit_daily (
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    day                 date NOT NULL,
    qualified_visits    integer NOT NULL DEFAULT 0 CHECK (qualified_visits >= 0),
    unique_visitors     integer NOT NULL DEFAULT 0 CHECK (unique_visitors >= 0),
    PRIMARY KEY (property_id, day)
);

CREATE TABLE gifts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    giver_resident_id   uuid NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
    recipient_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
    property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    space_id            uuid NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
    item_instance_id    uuid NOT NULL UNIQUE REFERENCES item_instances(id) ON DELETE RESTRICT,
    drop_x_u            integer NOT NULL,
    drop_y_u            integer NOT NULL,
    status              text NOT NULL DEFAULT 'pending_placement'
                        CHECK (status IN ('pending_placement','kept_here','put_away','declined')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz,
    CHECK (giver_resident_id <> recipient_resident_id)
);
CREATE INDEX gifts_recipient_status_idx ON gifts(recipient_resident_id, status, created_at DESC);

CREATE TABLE blocks (
    blocker_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    blocked_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_resident_id, blocked_resident_id),
    CHECK (blocker_resident_id <> blocked_resident_id)
);
CREATE INDEX blocks_reverse_idx ON blocks(blocked_resident_id, blocker_resident_id);

CREATE TABLE reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
    target_type         text NOT NULL CHECK (target_type IN ('resident','property','item')),
    target_id           uuid NOT NULL,
    reason_code         text NOT NULL,
    details             text,
    status              text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','reviewing','resolved','dismissed')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    resolved_at         timestamptz
);
CREATE INDEX reports_status_created_idx ON reports(status, created_at);

CREATE TABLE moderation_actions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id           uuid REFERENCES reports(id) ON DELETE SET NULL,
    target_type         text NOT NULL,
    target_id           uuid NOT NULL,
    action_type         text NOT NULL,
    reason              text,
    actor_admin_id      text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_target_idx ON moderation_actions(target_type, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Economy / ledger
-- ---------------------------------------------------------------------------

CREATE TABLE wallets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_kind         text NOT NULL CHECK (wallet_kind IN ('resident','city','mint','sink','system')),
    resident_id         uuid REFERENCES residents(id) ON DELETE RESTRICT,
    city_id             uuid REFERENCES cities(id) ON DELETE RESTRICT,
    system_code         text,
    currency_code       text NOT NULL DEFAULT 'WORLD',
    balance             bigint NOT NULL DEFAULT 0,
    allow_negative      boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (allow_negative OR balance >= 0),
    CHECK (
      (wallet_kind = 'resident' AND resident_id IS NOT NULL AND city_id IS NULL AND system_code IS NULL) OR
      (wallet_kind = 'city' AND resident_id IS NULL AND city_id IS NOT NULL AND system_code IS NULL) OR
      (wallet_kind IN ('mint','sink','system') AND resident_id IS NULL AND city_id IS NULL AND system_code IS NOT NULL)
    )
);
CREATE UNIQUE INDEX wallets_resident_currency_idx
    ON wallets(resident_id, currency_code) WHERE wallet_kind = 'resident';
CREATE UNIQUE INDEX wallets_city_currency_idx
    ON wallets(city_id, currency_code) WHERE wallet_kind = 'city';
CREATE UNIQUE INDEX wallets_system_currency_idx
    ON wallets(system_code, currency_code) WHERE wallet_kind IN ('mint','sink','system');

CREATE TABLE ledger_transactions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key     text NOT NULL UNIQUE,
    transaction_type    text NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','posted','void')),
    actor_resident_id   uuid REFERENCES residents(id) ON DELETE SET NULL,
    related_type        text,
    related_id          uuid,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    posted_at           timestamptz
);
CREATE INDEX ledger_transactions_actor_idx ON ledger_transactions(actor_resident_id, created_at DESC);

CREATE TABLE ledger_entries (
    id                  bigserial PRIMARY KEY,
    transaction_id      uuid NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    wallet_id           uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    amount              bigint NOT NULL CHECK (amount <> 0),
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(transaction_id);
CREATE INDEX ledger_entries_wallet_created_idx ON ledger_entries(wallet_id, created_at DESC);

CREATE OR REPLACE FUNCTION assert_ledger_balanced_before_post()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    total bigint;
BEGIN
    -- Once posted, the entire ledger transaction row is immutable. Corrections are reversals.
    IF OLD.status = 'posted' THEN
        RAISE EXCEPTION 'Posted ledger transaction % is immutable', OLD.id;
    END IF;

    IF NEW.status = 'posted' THEN
        SELECT COALESCE(SUM(amount), 0) INTO total
          FROM ledger_entries
         WHERE transaction_id = NEW.id;
        IF total <> 0 THEN
            RAISE EXCEPTION 'Ledger transaction % is not balanced; sum=%', NEW.id, total;
        END IF;
        NEW.posted_at := COALESCE(NEW.posted_at, now());
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_transactions_post_guard
BEFORE UPDATE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced_before_post();

CREATE OR REPLACE FUNCTION protect_posted_ledger_entries()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    tx_status text;
    tx_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        tx_id := OLD.transaction_id;
    ELSE
        tx_id := NEW.transaction_id;
    END IF;

    SELECT status INTO tx_status FROM ledger_transactions WHERE id = tx_id;
    IF tx_status = 'posted' THEN
        RAISE EXCEPTION 'Entries for posted ledger transaction % are immutable', tx_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER ledger_entries_insert_guard
BEFORE INSERT ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_ledger_entries();
CREATE TRIGGER ledger_entries_update_guard
BEFORE UPDATE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_ledger_entries();
CREATE TRIGGER ledger_entries_delete_guard
BEFORE DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_ledger_entries();

CREATE TABLE store_listings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid REFERENCES cities(id) ON DELETE RESTRICT,
    seller_kind         text NOT NULL CHECK (seller_kind IN ('system','city')),
    seller_wallet_id    uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    item_definition_id  uuid NOT NULL REFERENCES item_definitions(id) ON DELETE RESTRICT,
    item_instance_id    uuid REFERENCES item_instances(id) ON DELETE RESTRICT,
    unit_price          bigint NOT NULL CHECK (unit_price >= 0),
    stock_quantity      bigint CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
    status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','sold_out','ended')),
    starts_at           timestamptz NOT NULL DEFAULT now(),
    ends_at             timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_listings_active_idx ON store_listings(city_id, status, starts_at);

CREATE TABLE market_listings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_resident_id  uuid NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
    seller_wallet_id    uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    item_instance_id    uuid NOT NULL REFERENCES item_instances(id) ON DELETE RESTRICT,
    asking_price        bigint NOT NULL CHECK (asking_price > 0),
    status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','sold','cancelled','expired')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    ends_at             timestamptz,
    sold_at             timestamptz
);
CREATE UNIQUE INDEX market_one_active_listing_per_item_idx
    ON market_listings(item_instance_id) WHERE status = 'active';
CREATE INDEX market_listings_status_created_idx ON market_listings(status, created_at DESC);

CREATE TABLE procurement_orders (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    city_wallet_id      uuid NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
    category            text NOT NULL,
    recipe_family       text,
    quantity_total      integer NOT NULL CHECK (quantity_total > 0),
    quantity_remaining  integer NOT NULL CHECK (quantity_remaining >= 0),
    unit_price          bigint NOT NULL CHECK (unit_price > 0),
    per_creator_limit   integer NOT NULL DEFAULT 1 CHECK (per_creator_limit > 0),
    budget_total        bigint NOT NULL CHECK (budget_total > 0),
    budget_remaining    bigint NOT NULL CHECK (budget_remaining >= 0),
    status              text NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','open','filled','expired','cancelled')),
    starts_at           timestamptz NOT NULL,
    ends_at             timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (quantity_remaining <= quantity_total),
    CHECK (budget_remaining <= budget_total)
);
CREATE INDEX procurement_orders_city_status_idx ON procurement_orders(city_id, status, starts_at);

CREATE TABLE procurement_submissions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id            uuid NOT NULL REFERENCES procurement_orders(id) ON DELETE RESTRICT,
    creator_resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
    item_instance_id    uuid NOT NULL UNIQUE REFERENCES item_instances(id) ON DELETE RESTRICT,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','rejected','cancelled')),
    ledger_transaction_id uuid REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    submitted_at        timestamptz NOT NULL DEFAULT now(),
    decided_at          timestamptz
);
CREATE INDEX procurement_submissions_order_creator_idx ON procurement_submissions(order_id, creator_resident_id, status);

-- ---------------------------------------------------------------------------
-- Idempotency / outbox / deletion / flags
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation           text NOT NULL,
    idempotency_key     text NOT NULL,
    request_hash        text NOT NULL,
    response_status     integer,
    response_body       jsonb,
    resource_id         uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    PRIMARY KEY (user_id, operation, idempotency_key)
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys(expires_at);

CREATE TABLE outbox_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type          text NOT NULL,
    aggregate_type      text NOT NULL,
    aggregate_id        uuid,
    payload             jsonb NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','publishing','published','failed')),
    attempts            integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at        timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    published_at        timestamptz,
    last_error          text
);
CREATE INDEX outbox_pending_idx ON outbox_events(status, available_at) WHERE status IN ('pending','failed');

CREATE TABLE deletion_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status              text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested','processing','completed','failed','cancelled')),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    last_error          text
);
CREATE INDEX deletion_requests_status_idx ON deletion_requests(status, requested_at);

CREATE TABLE feature_flags (
    key                 text PRIMARY KEY,
    enabled             boolean NOT NULL DEFAULT false,
    config              jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Seed-level invariants expected from application transactions
-- ---------------------------------------------------------------------------
-- 1) Plot claim transaction MUST lock plots row and validate reservation.
-- 2) Purchase/gift/procurement MUST lock involved wallet/item rows deterministically.
-- 3) Wallet balances and ledger entries MUST be updated inside one DB transaction.
-- 4) Before ledger_transactions -> posted, entry sum MUST equal zero (DB trigger enforces).
-- 5) Do not mutate posted ledger entries; reversals are new transactions.
-- 6) High-level block checks are application authorization and MUST precede social transfers.
-- 7) Layout revision changes are compare-and-swap by expected revision.
-- 8) Stay creation MUST lock the target property (or capacity guard row), count active stays, and enforce capacity atomically.
-- 9) Gift decline returns the item to giver inventory when possible; keep/put-away transfers recipient ownership atomically.
-- 10) Effective away access = access_mode='open' AND (owner not away OR away_access_mode='open').

COMMIT;
