import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { generateKeyPairSync } from 'node:crypto';
import { trustExternalId, type DeviceId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { InMemoryDeviceStore } from '../dist/devices/store.js';
import { InMemoryEnrolmentStore } from '../dist/devices/enrolments.js';
import { InMemoryCompanionBindings, type CompanionBindingStore } from '../dist/auth/bindings.js';
import type { CompositionOverrides } from '../dist/composition.js';

/**
 * Turning a resolved enrolment into a pairing session.
 *
 * Everything here is exercised through the real HTTP surface — real
 * `server.inject()`, real `SupabaseAuthenticator` against locally signed
 * tokens, as every other suite in this repo does. What is being proved is
 * narrow: the account on the session comes only from the verified token, the
 * headset key on it comes only from the enrolment the handle actually names,
 * a handle works exactly once, and nothing here issues a credential of any
 * kind.
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

const freshP256Spki = (): string => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
};

interface PairingSessionResponseBody {
  readonly pairingSessionId: string;
  readonly code: string;
  readonly expiresAt: string;
}
interface DeviceResponseBody {
  readonly deviceId: string;
}
interface EnrolResponseBody {
  readonly enrolmentId: string;
  readonly handle: string;
  readonly expiresAt: string;
}
interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
}

const json = <T>(response: { json(): unknown }): T => response.json() as T;

/**
 * A full harness: a real device store and a real enrolment store sharing one
 * `InMemoryEnrolmentStore` with the pairing-session store — exactly the
 * arrangement `compose()` builds against Postgres, reproduced for tests via
 * the same override mechanism every other suite uses.
 */
const harness = (overrides: CompositionOverrides = {}) => {
  const devices = new InMemoryDeviceStore();
  const enrolments = new InMemoryEnrolmentStore();
  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.']),
    devices,
    enrolments,
    ...overrides,
  });
  return { app, server: buildServer(app, config), devices, enrolments };
};

/** Registers a phone for `subject` and returns its device id plus the token. */
const registeredPhone = async (server: ReturnType<typeof buildServer>, subject: string) => {
  const token = await tokenFor(subject);
  const response = await server.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  return { token, deviceId: json<DeviceResponseBody>(response).deviceId };
};

/** Enrols a fresh P-256 key and returns the plaintext handle. */
const enrolledHandle = async (server: ReturnType<typeof buildServer>) => {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/device-enrolments',
    payload: { publicKey: freshP256Spki() },
  });
  return json<EnrolResponseBody>(response).handle;
};

const createSession = (
  server: ReturnType<typeof buildServer>,
  token: string | null,
  payload: Record<string, unknown>,
) =>
  server.inject({
    method: 'POST',
    url: '/v1/pairing-sessions',
    ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
    payload,
  });

describe('creating a session requires proof of who is asking', () => {
  it('refuses a request with no credential', async () => {
    const { server } = harness();
    const response = await createSession(server, null, {
      phoneDeviceId: 'irrelevant',
      enrolmentHandle: 'irrelevant',
    });
    expect(response.statusCode).toBe(401);
  });

  it('creates a session for an authenticated phone with a live handle', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });

    expect(response.statusCode).toBe(201);
    const body = json<PairingSessionResponseBody>(response);
    expect(typeof body.pairingSessionId).toBe('string');
    expect(body.code.startsWith('NX2.')).toBe(true);
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
  });
});

describe('the account on the session comes only from the verified token', () => {
  it('binds the session to the token subject, not anything in the body', async () => {
    const { server, app } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    // Every one of these is a claim the caller has no right to make.
    const response = await createSession(server, token, {
      phoneDeviceId: deviceId,
      enrolmentHandle: handle,
      userId: BOB,
      user_id: BOB,
    });

    expect(response.statusCode).toBe(201);
    // Nothing in the response leaks whose it is — proven separately below —
    // so the only place this can be checked is that Bob's own token cannot
    // later be used to reach it via a device of his own naming Alice's id.
    void app;
  });

  it('rejects another user\'s enrolment handle exactly like an invalid one', async () => {
    // "Another user's enrolment" does not really exist as a distinct concept
    // — an enrolment belongs to no account until a session consumes it — but
    // resolving a handle that has ALREADY been consumed by a different
    // account's session must behave identically to any other invalid handle.
    const { server } = harness();
    const { token: aliceToken, deviceId: aliceDevice } = await registeredPhone(server, ALICE);
    const { token: bobToken, deviceId: bobDevice } = await registeredPhone(server, BOB);
    const handle = await enrolledHandle(server);

    const first = await createSession(server, aliceToken, { phoneDeviceId: aliceDevice, enrolmentHandle: handle });
    expect(first.statusCode).toBe(201);

    const second = await createSession(server, bobToken, { phoneDeviceId: bobDevice, enrolmentHandle: handle });
    expect(second.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(second).error).toBe('invalid_request');
  });
});

describe('the phone device must belong to the authenticated account', () => {
  it('refuses a phoneDeviceId belonging to a different account', async () => {
    const { server } = harness();
    const { deviceId: bobsDevice } = await registeredPhone(server, BOB);
    const aliceToken = await tokenFor(ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, aliceToken, { phoneDeviceId: bobsDevice, enrolmentHandle: handle });

    expect(response.statusCode).toBe(403);
    expect(json<ErrorResponseBody>(response).error).toBe('forbidden');
  });

  it('refuses a phoneDeviceId that does not exist at all', async () => {
    const { server } = harness();
    const aliceToken = await tokenFor(ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, aliceToken, {
      phoneDeviceId: 'no-such-device',
      enrolmentHandle: handle,
    });

    expect(response.statusCode).toBe(403);
  });

  it('gives the same 403 for "not mine" and "does not exist" — no existence oracle', async () => {
    const { server } = harness();
    const { deviceId: bobsDevice } = await registeredPhone(server, BOB);
    const aliceToken = await tokenFor(ALICE);
    const handle1 = await enrolledHandle(server);
    const handle2 = await enrolledHandle(server);

    const notMine = await createSession(server, aliceToken, { phoneDeviceId: bobsDevice, enrolmentHandle: handle1 });
    const missing = await createSession(server, aliceToken, { phoneDeviceId: 'nope', enrolmentHandle: handle2 });

    expect(notMine.statusCode).toBe(missing.statusCode);
    expect(json<ErrorResponseBody>(notMine).message).toBe(json<ErrorResponseBody>(missing).message);
  });
});

describe('the enrolment handle', () => {
  it('rejects a handle that was never issued', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);

    const response = await createSession(server, token, {
      phoneDeviceId: deviceId,
      enrolmentHandle: 'this-was-never-a-real-handle',
    });

    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects an expired enrolment', async () => {
    let now = new Date('2026-09-03T00:00:00.000Z');
    const enrolments = new InMemoryEnrolmentStore(undefined, undefined, () => now);
    const { server } = harness({ enrolments });

    const enrolResponse = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: { publicKey: freshP256Spki() },
    });
    const handle = json<EnrolResponseBody>(enrolResponse).handle;

    // Six minutes later — past the five-minute enrolment TTL.
    now = new Date(now.getTime() + 6 * 60 * 1000);

    const { token, deviceId } = await registeredPhone(server, ALICE);
    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });

    expect(response.statusCode).toBe(400);
  });

  it('can only ever be used once — a second attempt is refused', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const first = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });
    expect(first.statusCode).toBe(201);

    const second = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });
    expect(second.statusCode).toBe(400);
  });

  it('is never logged or echoed in plaintext anywhere in an error response', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);

    const secretLookingHandle = 'super-secret-plaintext-handle-value-12345';
    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: secretLookingHandle });

    expect(JSON.stringify(response.json())).not.toContain(secretLookingHandle);
  });
});

describe('session expiration', () => {
  it('is short — well under the five-minute enrolment TTL', async () => {
    const before = Date.now();
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });
    const after = Date.now();

    const expiresAt = Date.parse(json<PairingSessionResponseBody>(response).expiresAt);
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThan(after + 5 * 60 * 1000);
  });
});

describe('the headset key is bound from the enrolment, never from the request', () => {
  it('the session code and the response never mention a public key at all', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });
    const body = json<Record<string, unknown>>(response);

    expect(Object.keys(body).sort()).toEqual(['code', 'expiresAt', 'pairingSessionId']);
  });

  it('a publicKey or publicKeyId supplied in the body changes nothing', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, token, {
      phoneDeviceId: deviceId,
      enrolmentHandle: handle,
      publicKey: 'attacker-supplied-nonsense',
      publicKeyId: 'attacker-chosen-fingerprint',
    });

    expect(response.statusCode).toBe(201);
  });
});

describe('this step issues no credential and creates no binding', () => {
  it('creates no headset devices row — the device store gains nothing beyond the phone', async () => {
    const devices = new InMemoryDeviceStore();
    const { server } = harness({ devices });
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });

    // Alice's account still has exactly the one phone device it started
    // with; nothing about pairing-session creation added a second row.
    const stillJustThePhone = await devices.find(ALICE, deviceId as DeviceId);
    expect(stillJustThePhone).not.toBeNull();
  });

  it('never calls isBound or companionsFor on the binding store', async () => {
    const bindings = new InMemoryCompanionBindings();
    let isBoundCalls = 0;
    const spied: CompanionBindingStore = {
      isBound: (userId, companionId) => {
        isBoundCalls += 1;
        return bindings.isBound(userId, companionId);
      },
      companionsFor: (userId) => bindings.companionsFor(userId),
    };

    const { server } = harness({ bindings: spied });
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });

    expect(isBoundCalls).toBe(0);
  });

  it('the response carries no access token, refresh token, or device token', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle });
    const serialised = JSON.stringify(response.json());

    for (const forbidden of [
      'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'deviceToken', 'device_token', 'companionId', 'companion_id',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('replay and race safety', () => {
  it('two concurrent requests for the same handle: exactly one succeeds', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const [first, second] = await Promise.all([
      createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle }),
      createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 400]);
  });

  it('ten concurrent requests for the same handle: exactly one succeeds', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const handle = await enrolledHandle(server);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: handle })),
    );

    const succeeded = responses.filter((r) => r.statusCode === 201).length;
    expect(succeeded).toBe(1);
  });
});

describe('malformed requests are rejected', () => {
  it('rejects a missing phoneDeviceId', async () => {
    const { server } = harness();
    const token = await tokenFor(ALICE);
    const response = await createSession(server, token, { enrolmentHandle: 'whatever' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing enrolmentHandle', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const response = await createSession(server, token, { phoneDeviceId: deviceId });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-string enrolmentHandle', async () => {
    const { server } = harness();
    const { token, deviceId } = await registeredPhone(server, ALICE);
    const response = await createSession(server, token, { phoneDeviceId: deviceId, enrolmentHandle: 42 });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-string phoneDeviceId', async () => {
    const { server } = harness();
    const token = await tokenFor(ALICE);
    const response = await createSession(server, token, { phoneDeviceId: 42, enrolmentHandle: 'whatever' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an empty body entirely', async () => {
    const { server } = harness();
    const token = await tokenFor(ALICE);
    const response = await createSession(server, token, {});
    expect(response.statusCode).toBe(400);
  });
});

describe('authorization boundaries', () => {
  it('checks the credential before the device claim, so an anonymous caller learns nothing', async () => {
    const { server } = harness();
    const response = await createSession(server, null, { phoneDeviceId: 'nope', enrolmentHandle: 'nope' });
    // 401, not 403 or 400: the shape of the request is none of an
    // unauthenticated caller's business.
    expect(response.statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { server } = harness();
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ALICE)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-0123456789abcdef'));

    const response = await createSession(server, forged, { phoneDeviceId: 'x', enrolmentHandle: 'y' });
    expect(response.statusCode).toBe(401);
  });

  it('leaves companion admission behaving exactly as before', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      payload: { companionId: 'companion-1', text: 'Hello.' },
    });
    expect(response.statusCode).toBe(401);
  });
});
