/**
 * Server-side tunables. Anything marked DEV_PLACEHOLDER is a non-blocking product value
 * (Blueprint Part XX) that has not been decided yet. Values can be overridden at runtime
 * through the feature_flags table (key -> config jsonb) without a deploy.
 */
export const RESERVATION_TTL_SECONDS = 10 * 60; // Blueprint §7.4
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
export const VISIT_QUALIFY_DWELL_SECONDS = 5; // Blueprint §11.1 (configuration)
export const VISIT_RECEIPT_RETENTION_DAYS = 7; // Blueprint §11.1
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // Blueprint §14.4
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 24 * 60 * 60;

export const STAY_CAPACITY_MAX = 20; // schema bound
export const DEFAULT_STAY_CAPACITY = 4;

/** DEV_PLACEHOLDER — exact starter grant is an open product question. Minor WORLD units. */
export const STARTER_GRANT_WORLD = 500;

/** DEV_PLACEHOLDER — starter kit handed out atomically with the first home claim. */
export const STARTER_KIT_DEFINITION_KEYS = [
  'furniture.bed.simple.001',
  'furniture.chair.softwood.001',
  'furniture.table.round.001',
  'decor.lamp.paper.001',
];

/** Starter structures a new resident may pick in onboarding (one property family, visual variants). */
export const STARTER_STRUCTURE_ASSET_IDS = [
  'structure.home.cottage.a',
  'structure.home.cottage.b',
  'structure.home.cottage.c',
];

/**
 * Interior bounds for a v0.1 main space, in units (12 x 12 tiles).
 * Keyed by asset_shell_id; `default` applies when the shell is unknown.
 */
export const SPACE_BOUNDS: Record<string, { minX: number; minY: number; maxX: number; maxY: number }> = {
  default: { minX: 0, minY: 0, maxX: 12_000, maxY: 12_000 },
};

export const MAX_PLACEMENTS_PER_SPACE = 500;

/** Blueprint §7.2 locked activation policy. Coefficients are server configuration. */
export interface ActivationPolicy {
  ratio: number;
  min: number;
  max: number;
}
export const DEFAULT_ACTIVATION_POLICY: ActivationPolicy = { ratio: 0.15, min: 8, max: 20 };

/** Feature flag keys (feature_flags.key). */
export const FLAGS = {
  activationPolicy: 'city.activation_policy',
  visitExactCounts: 'visits.exact_counts',
  starterGrant: 'economy.starter_grant',
  creatorEconomy: 'creator.enabled',
  procurement: 'procurement.enabled',
  marketplace: 'market.enabled',
} as const;
