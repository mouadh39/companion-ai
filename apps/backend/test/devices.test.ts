import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { trustExternalId, type DeviceId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { InMemoryDeviceStore } from '../dist/devices/store.js';

/**
 * Registering the phone.
 *
 * The first durable device on an account, and the precondition for pairing.
 * What matters here is narrow: the account on the new row comes from the
 * verified token and from nowhere else, and the three fields a caller must not
 * choose — account, kind, id — are not choosable.
 *
 * These go through the real HTTP surface and the real Supabase verifier, as
 * `auth.test.ts` does. Nothing is stubbed except the language model, which no
 * device route touches.
 */

const JWT_SECRET = 'test-secret-not-used-anywhere-real-0123456789abcdef';

const config: AppConfig = {
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  groqApiKey: null,
  providerTimeoutMs: 30_000,
  databaseUrl: null,
  openAiApiKey: null,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
  supabaseJwtSecret: JWT_SECRET,
  deviceTokenSecret: null,
};

const ALICE = trustExternalId<UserId>('alice-uuid');
const BOB = trustExternalId<UserId>('bob-uuid');

const tokenFor = async (subject: string): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

const harness = () => {
  const devices = new InMemoryDeviceStore();
  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.']),
    devices,
  });
  return { app, server: buildServer(app, config), devices };
};

/** The shape `POST /v1/devices` answers with on success. */
interface DeviceResponseBody {
  readonly deviceId: string;
  readonly kind: string;
  readonly label: string | null;
  readonly registeredAt: string;
}

/** The shape every route in this file answers with on refusal. */
interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
}

/**
 * `response.json()` is typed `any` by `light-my-request`, which is accurate —
 * it has not parsed the body against any schema — but every response here has
 * a known shape, so the cast states what this suite already relies on rather
 * than leaving each call site to assert it silently.
 */
const json = <T>(response: { json(): unknown }): T => response.json() as T;

const register = async (token: string | null, payload: Record<string, unknown> = {}) => {
  const { server, devices } = harness();
  const response = await server.inject({
    method: 'POST',
    url: '/v1/devices',
    ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
    payload,
  });
  return { response, devices };
};

describe('a device belongs to whoever proved they own it', () => {
  it('refuses a caller with no credential', async () => {
    const { response } = await register(null);
    expect(response.statusCode).toBe(401);
    expect(json<ErrorResponseBody>(response).error).toBe('unauthenticated');
  });

  it('refuses a token signed with the wrong secret', async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ALICE)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-0123456789abcdef'));

    const { response } = await register(forged);
    expect(response.statusCode).toBe(401);
  });

  it('registers a phone for an authenticated caller', async () => {
    const { response } = await register(await tokenFor(ALICE), { label: 'iPhone 16 Pro Max' });

    expect(response.statusCode).toBe(201);
    const body = json<DeviceResponseBody>(response);
    expect(body.kind).toBe('phone');
    expect(body.label).toBe('iPhone 16 Pro Max');
    expect(typeof body.deviceId).toBe('string');
    expect(body.deviceId.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.registeredAt))).toBe(false);
  });

  it('takes the account from the verified token, not from the body', async () => {
    const { response, devices } = await register(await tokenFor(ALICE), {
      label: 'Mine',
      // Every one of these is a claim the caller has no right to make.
      userId: BOB,
      user_id: BOB,
      kind: 'headset',
      id: 'chosen-by-the-client',
      deviceId: 'chosen-by-the-client',
    });

    expect(response.statusCode).toBe(201);
    const body = json<DeviceResponseBody>(response);

    // The row is Alice's, and readable only by Alice.
    const asAlice = await devices.find(ALICE, body.deviceId as DeviceId);
    expect(asAlice).not.toBeNull();
    expect(asAlice?.userId).toBe(ALICE);

    const asBob = await devices.find(BOB, body.deviceId as DeviceId);
    expect(asBob).toBeNull();
  });

  it('is always a phone, whatever the body asks for', async () => {
    const { response, devices } = await register(await tokenFor(ALICE), { kind: 'headset' });

    expect(json<DeviceResponseBody>(response).kind).toBe('phone');
    const row = await devices.find(ALICE, json<DeviceResponseBody>(response).deviceId as DeviceId);
    expect(row?.kind).toBe('phone');
  });

  it('mints the id server-side and ignores one the client supplies', async () => {
    const chosen = 'client-chosen-device-id';
    const { response } = await register(await tokenFor(ALICE), { id: chosen, deviceId: chosen });

    expect(json<DeviceResponseBody>(response).deviceId).not.toBe(chosen);
  });

  it('gives two registrations two different ids', async () => {
    const token = await tokenFor(ALICE);
    const { server } = harness();
    const once = await server.inject({
      method: 'POST', url: '/v1/devices',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });
    const twice = await server.inject({
      method: 'POST', url: '/v1/devices',
      headers: { authorization: `Bearer ${token}` }, payload: {},
    });

    expect(json<DeviceResponseBody>(once).deviceId).not.toBe(json<DeviceResponseBody>(twice).deviceId);
  });
});

describe('the label is decoration and behaves like it', () => {
  it('accepts a registration with no body field at all', async () => {
    const { response } = await register(await tokenFor(ALICE), {});
    expect(response.statusCode).toBe(201);
    expect(json<DeviceResponseBody>(response).label).toBeNull();
  });

  it('treats a blank label as no label rather than failing the request', async () => {
    const { response } = await register(await tokenFor(ALICE), { label: '   ' });
    expect(response.statusCode).toBe(201);
    expect(json<DeviceResponseBody>(response).label).toBeNull();
  });

  it('trims a label rather than storing the whitespace', async () => {
    const { response } = await register(await tokenFor(ALICE), { label: '  Pixel 9  ' });
    expect(json<DeviceResponseBody>(response).label).toBe('Pixel 9');
  });

  it('ignores a non-string label instead of rejecting the device', async () => {
    const { response } = await register(await tokenFor(ALICE), { label: 42 });
    expect(response.statusCode).toBe(201);
    expect(json<DeviceResponseBody>(response).label).toBeNull();
  });
});

describe('the response says only what it should', () => {
  it('carries no account, key material or internal state', async () => {
    const { response } = await register(await tokenFor(ALICE), { label: 'Phone' });
    const body = json<DeviceResponseBody>(response);

    expect(Object.keys(body).sort()).toEqual(['deviceId', 'kind', 'label', 'registeredAt']);

    const serialised = JSON.stringify(body);
    for (const forbidden of [
      ALICE, 'user_id', 'userId',
      'public_key', 'publicKey', 'public_key_id',
      'handle', 'handle_hash', 'code_hash',
      'token', 'secret', 'revoked_at',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('registering a device changes nothing about companion admission', () => {
  it('still refuses a turn from a caller with no credential', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST', url: '/v1/turn',
      payload: { companionId: 'companion-1', text: 'Hello.' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('still requires a companionId from an authenticated caller', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST', url: '/v1/turn',
      headers: { authorization: `Bearer ${await tokenFor(ALICE)}` },
      payload: { text: 'Hello.' },
    });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });
});
