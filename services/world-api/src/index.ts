import pg from 'pg';
import { createDb } from '@as/db';
import { createApp } from './app';
import { createAppleProvider, devAppleProvider } from './auth/apple';
import type { AppDeps, Environment, RateClass, RateLimiter } from './deps';

export { createApp } from './app';
export type * from './deps';
export { devAppleProvider, createAppleProvider } from './auth/apple';

interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  HYPERDRIVE: Hyperdrive;
  ENVIRONMENT: Environment;
  JWT_SECRET: string;
  TOKEN_ENCRYPTION_KEY: string;
  ASSET_BASE_URL: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  /** "true" enables dev:<subject> identity tokens. Refused in production. */
  DEV_AUTH?: string;
  RL_AUTH?: RateLimitBinding;
  RL_ECONOMY?: RateLimitBinding;
  RL_SOCIAL?: RateLimitBinding;
  RL_WRITE?: RateLimitBinding;
}

function rateLimiterFrom(env: Env): RateLimiter {
  const pick = (cls: RateClass): RateLimitBinding | undefined => {
    switch (cls) {
      case 'auth':
      case 'plot':
        return env.RL_AUTH;
      case 'purchase':
      case 'gift':
        return env.RL_ECONOMY;
      case 'visit':
      case 'stay':
        return env.RL_SOCIAL;
      default:
        return env.RL_WRITE;
    }
  };
  return {
    async allow(cls, key) {
      const b = pick(cls);
      if (!b) return true;
      return (await b.limit({ key: `${cls}:${key}` })).success;
    },
  };
}

export function depsFromEnv(env: Env): AppDeps {
  const devAuth = env.DEV_AUTH === 'true';
  if (devAuth && env.ENVIRONMENT === 'production') throw new Error('DEV_AUTH must never be enabled in production');
  const apple = devAuth
    ? devAppleProvider
    : createAppleProvider({
        clientId: required(env.APPLE_CLIENT_ID, 'APPLE_CLIENT_ID'),
        teamId: required(env.APPLE_TEAM_ID, 'APPLE_TEAM_ID'),
        keyId: required(env.APPLE_KEY_ID, 'APPLE_KEY_ID'),
        privateKeyPem: required(env.APPLE_PRIVATE_KEY, 'APPLE_PRIVATE_KEY'),
      });
  return {
    config: {
      environment: env.ENVIRONMENT,
      jwtSecret: required(env.JWT_SECRET, 'JWT_SECRET'),
      tokenEncryptionKey: required(env.TOKEN_ENCRYPTION_KEY, 'TOKEN_ENCRYPTION_KEY'),
      assetBaseUrl: env.ASSET_BASE_URL,
    },
    // One short-lived pg client per request; Hyperdrive pools the real connections.
    async openDb() {
      const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      return { db: createDb(client), close: () => client.end() };
    },
    apple,
    rateLimiter: rateLimiterFrom(env),
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

function required(v: string | undefined, name: string): string {
  if (!v) throw new Error(`missing secret/var ${name}`);
  return v;
}

let cached: { env: Env; app: ReturnType<typeof createApp> } | undefined;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!cached || cached.env !== env) cached = { env, app: createApp(depsFromEnv(env)) };
    return cached.app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// Shared with the jobs Worker.
export { postLedger, systemWalletId, residentWalletId } from './services/ledger';
export { decryptToken, encryptToken } from './auth/cipher';
export { lockPresence, endStays, isBlockedEitherWay } from './services/social';
export { createAdminApp, cloudflareAccessVerifier, type AdminVerifier } from './admin/app';
