import type { Db } from '@as/db';

export type Environment = 'local' | 'test' | 'staging' | 'production';

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

export interface AppleIdentity {
  subject: string;
  email?: string;
}

/** Sign in with Apple. Real implementation in auth/apple.ts; tests inject a fake. */
export interface AppleAuthProvider {
  verifyIdentityToken(identityToken: string, rawNonce: string): Promise<AppleIdentity>;
  /** Exchange the one-time authorization code; returns Apple's refresh token (needed for revocation). */
  exchangeAuthorizationCode(code: string): Promise<{ refreshToken?: string }>;
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

export type RateClass = 'auth' | 'plot' | 'visit' | 'stay' | 'gift' | 'purchase' | 'report' | 'write';

export interface RateLimiter {
  /** Returns true when the call is allowed. */
  allow(cls: RateClass, key: string): Promise<boolean>;
}

export const allowAll: RateLimiter = { allow: async () => true };

export interface AppConfig {
  environment: Environment;
  /** HS256 secret for access tokens (>= 32 bytes). */
  jwtSecret: string;
  /** base64 32-byte key for AES-GCM encryption of provider tokens at rest. */
  tokenEncryptionKey: string;
  /** Public base URL for asset manifests (R2/custom domain). */
  assetBaseUrl: string;
}

export interface AppDeps {
  config: AppConfig;
  openDb(): Promise<DbHandle>;
  apple: AppleAuthProvider;
  rateLimiter: RateLimiter;
  /** Structured log sink; never pass tokens/codes/notes. */
  log(entry: Record<string, unknown>): void;
}
