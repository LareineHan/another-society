import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestWorld, count, type TestWorld } from './helpers';

let t: TestWorld;
beforeAll(async () => { t = await setupTestWorld(); });
afterAll(async () => { await t.close(); });

describe('Milestone 0/1: health, auth, resident', () => {
  it('health reports DB + schema version', async () => {
    const r = await t.call(null, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, schema_version: '002_contract_alignment' });
    expect(r.headers.get('x-request-id')).toMatch(/^req_/);
  });

  it('Sign in with Apple creates once, then returns the same users.id', async () => {
    const body = { identity_token: 'dev:same-person', authorization_code: 'c', nonce: 'nonce-123456' };
    const first = await t.call(null, 'POST', '/v1/auth/apple', body);
    const second = await t.call(null, 'POST', '/v1/auth/apple', body);
    expect(first.status).toBe(201);
    expect(first.body.is_new_account).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body.is_new_account).toBe(false);
    expect(second.body.user_id).toBe(first.body.user_id);
    expect(await count(t.db, t.sql`SELECT count(*)::int AS n FROM residents WHERE user_id = ${first.body.user_id}`)).toBe(1);
    // Apple refresh token is stored encrypted, never in clear text.
    const enc = await count(t.db, t.sql`SELECT count(*)::int AS n FROM auth_identities WHERE user_id = ${first.body.user_id} AND provider_refresh_token_enc IS NOT NULL
                                         AND position(convert_to('dev-apple-refresh-token','UTF8') in provider_refresh_token_enc) = 0`);
    expect(enc).toBe(1);
  });

  it('rejects bad identity tokens and unauthenticated calls with the error envelope', async () => {
    expect((await t.call(null, 'POST', '/v1/auth/apple', { identity_token: 'forged', authorization_code: 'c', nonce: 'nonce-123456' })).status).toBe(401);
    expect((await t.call(null, 'GET', '/v1/me')).status).toBe(401);
    expect((await t.call({ token: 'garbage' } as never, 'GET', '/v1/me')).status).toBe(401);
  });

  it('refresh rotates; old refresh token and revoked sessions stop working', async () => {
    const a = await t.signUp('rotator');
    const r1 = await t.call(null, 'POST', '/v1/auth/refresh', { refresh_token: a.refreshToken });
    expect(r1.status).toBe(200);
    expect((await t.call(null, 'POST', '/v1/auth/refresh', { refresh_token: a.refreshToken })).status).toBe(401);
    const fresh = { ...a, token: r1.body.access_token };
    expect((await t.call(fresh, 'GET', '/v1/me')).status).toBe(200);
    expect((await t.call(fresh, 'POST', '/v1/auth/logout')).status).toBe(204);
    // Access token is still unexpired, but the session is revoked: immediate 401.
    expect((await t.call(fresh, 'GET', '/v1/me')).status).toBe(401);
    expect((await t.call(null, 'POST', '/v1/auth/refresh', { refresh_token: r1.body.refresh_token })).status).toBe(401);
  });

  it('bootstraps resident with public tag, wallet and presence', async () => {
    const a = await t.signUp('boot');
    const me = await t.call(a, 'GET', '/v1/me');
    expect(me.body.resident).toMatchObject({ display_name: 'Newcomer', onboarding_state: 'choosing_plot' });
    expect(me.body.resident.public_tag).toMatch(/^[2-9A-HJKMNP-TV-Z]{6}$/);
    expect((await t.call(a, 'GET', '/v1/wallet')).body).toEqual({ currency_code: 'WORLD', balance: 0 });
  });

  it('display name: NFC, 1–24 graphemes, control/bidi characters and screened terms rejected', async () => {
    const a = await t.signUp('namer');
    const ok = await t.call(a, 'PATCH', '/v1/resident', { display_name: '  Mori  ' });
    expect(ok.status).toBe(200);
    expect(ok.body.display_name).toBe('Mori');
    expect((await t.call(a, 'PATCH', '/v1/resident', { display_name: '모리🌲👩‍👩‍👧' })).status).toBe(200);
    expect((await t.call(a, 'PATCH', '/v1/resident', { display_name: 'x'.repeat(25) })).status).toBe(422);
    expect((await t.call(a, 'PATCH', '/v1/resident', { display_name: 'evil‮eman' })).status).toBe(422);
    expect((await t.call(a, 'PATCH', '/v1/resident', { display_name: 'Official Admin' })).status).toBe(422);
  });

  it('Mini accepts only approved parts', async () => {
    const a = await t.signUp('mini');
    const ok = await t.call(a, 'PUT', '/v1/resident/mini', { definition: { hair: 'mini.hair.bob', accessory: 'mini.acc.scarf' } });
    expect(ok.status).toBe(200);
    expect(ok.body.mini_definition).toMatchObject({ version: 1, hair: 'mini.hair.bob', body: 'mini.body.a' });
    expect((await t.call(a, 'PUT', '/v1/resident/mini', { definition: { hair: 'https://evil.example/x.png' } })).status).toBe(422);
    expect((await t.call(a, 'PUT', '/v1/resident/mini', { definition: { tattoo: 'x' } })).status).toBe(422);
  });
});
