/** AES-256-GCM for provider tokens at rest. Output: 12-byte IV || ciphertext+tag. */
const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(b64: string): Promise<CryptoKey> {
  let p = keyCache.get(b64);
  if (!p) {
    const raw = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (base64)');
    p = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keyCache.set(b64, p);
  }
  return p;
}

export async function encryptToken(keyB64: string, plaintext: string): Promise<Uint8Array> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(keyB64), new TextEncoder().encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return out;
}

export async function decryptToken(keyB64: string, blob: Uint8Array): Promise<string> {
  const iv = blob.slice(0, 12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await importKey(keyB64), blob.slice(12));
  return new TextDecoder().decode(pt);
}
