import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose';
import { DomainError } from '@as/domain';
import type { AppleAuthProvider, AppleIdentity } from '../deps';

const APPLE_ISSUER = 'https://appleid.apple.com';
const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

async function sha256Hex(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export interface AppleConfig {
  /** iOS bundle id (audience of identity tokens), e.g. com.implemon.anothersociety */
  clientId: string;
  teamId: string;
  keyId: string;
  /** Contents of the Sign in with Apple .p8 key (PKCS#8 PEM). */
  privateKeyPem: string;
}

/**
 * Production Sign in with Apple (Blueprint §14.3):
 * - verify identity token signature (Apple JWKS), iss, aud, exp
 * - verify nonce: the app sends the raw nonce; Apple embeds SHA-256(raw) in the token
 * - use `sub` (stable user identifier), never email, as the provider subject
 */
export function createAppleProvider(cfg: AppleConfig): AppleAuthProvider {
  let secretCache: { value: string; exp: number } | undefined;
  const clientSecret = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (secretCache && secretCache.exp - 300 > now) return secretCache.value;
    const key = await importPKCS8(cfg.privateKeyPem, 'ES256');
    const exp = now + 60 * 60 * 24 * 30;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(cfg.teamId).setIssuedAt(now).setExpirationTime(exp)
      .setAudience(APPLE_ISSUER).setSubject(cfg.clientId)
      .sign(key);
    secretCache = { value, exp };
    return value;
  };

  return {
    async verifyIdentityToken(identityToken: string, rawNonce: string): Promise<AppleIdentity> {
      let payload;
      try {
        ({ payload } = await jwtVerify(identityToken, jwks, { issuer: APPLE_ISSUER, audience: cfg.clientId, algorithms: ['RS256'] }));
      } catch {
        throw new DomainError('unauthorized', 'Sign in with Apple could not be verified.');
      }
      if (typeof payload.sub !== 'string' || !payload.sub) throw new DomainError('unauthorized', 'Sign in with Apple could not be verified.');
      if (payload.nonce !== (await sha256Hex(rawNonce))) throw new DomainError('unauthorized', 'Sign in with Apple could not be verified.');
      return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
    },

    async exchangeAuthorizationCode(code: string) {
      const res = await fetch(`${APPLE_ISSUER}/auth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: await clientSecret(), code, grant_type: 'authorization_code' }),
      });
      if (!res.ok) throw new DomainError('unauthorized', 'Sign in with Apple could not be verified.');
      const body = (await res.json()) as { refresh_token?: string };
      return { refreshToken: body.refresh_token };
    },

    async revokeRefreshToken(refreshToken: string) {
      const res = await fetch(`${APPLE_ISSUER}/auth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: await clientSecret(), token: refreshToken, token_type_hint: 'refresh_token' }),
      });
      if (!res.ok) throw new Error(`apple revoke failed: ${res.status}`);
    },
  };
}

/**
 * LOCAL/TEST ONLY. Accepts identity tokens of the form "dev:<subject>".
 * index.ts refuses to start with this provider when ENVIRONMENT=production.
 */
export const devAppleProvider: AppleAuthProvider = {
  async verifyIdentityToken(identityToken) {
    const m = /^dev:([A-Za-z0-9._-]{1,64})$/.exec(identityToken);
    if (!m) throw new DomainError('unauthorized', 'Sign in with Apple could not be verified.');
    return { subject: `dev.${m[1]}` };
  },
  async exchangeAuthorizationCode() {
    return { refreshToken: 'dev-apple-refresh-token' };
  },
  async revokeRefreshToken() {},
};
