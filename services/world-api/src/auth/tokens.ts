import { SignJWT, jwtVerify } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '@as/domain';

const ISSUER = 'another-society';
const AUDIENCE = 'another-society-api';

const keyCache = new Map<string, Uint8Array>();
const hmacKey = (secret: string) => {
  let k = keyCache.get(secret);
  if (!k) {
    if (secret.length < 32) throw new Error('JWT secret must be at least 32 characters');
    k = new TextEncoder().encode(secret);
    keyCache.set(secret, k);
  }
  return k;
};

export async function signAccessToken(secret: string, userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(hmacKey(secret));
}

export async function verifyAccessToken(secret: string, token: string): Promise<{ userId: string; sessionId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, hmacKey(secret), { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    return null;
  }
}

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Opaque refresh token: 256 random bits. Only its SHA-256 is stored (auth_sessions.refresh_token_hash). */
export function newRefreshToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b64url(b);
}

export async function hashRefreshToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}
