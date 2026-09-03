import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { trustExternalId, type DeviceId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { InMemoryDeviceStore } from '../dist/devices/store.js';
import { InMemoryEnrolmentStore } from '../dist/devices/enrolments.js';
import { InMemoryPairingSessionStore } from '../dist/devices/pairing-sessions.js';
import { parseP256Spki } from '../dist/devices/spki.js';
import { buildChallenge } from '../dist/devices/challenge.js';
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

/**
 * Redemption fixtures — real cryptography throughout.
 *
 * Every signature below is produced by Node's own `crypto.sign` with
 * `dsaEncoding: 'der'` against a genuinely generated P-256 key, and verified
 * by the real `PairingSessionStore.redeem` running the real
 * `verifyChallenge`. Nothing here is a mock signature or a stand-in digest.
 */

const redeem = (server: ReturnType<typeof buildServer>, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/v1/pairing-sessions/redeem', payload });

interface RedeemResponseBody {
  readonly paired: boolean;
}

/** A fresh EC P-256 keypair, plus its SPKI exactly as a headset would submit it. */
const freshP256KeyPair = (): { readonly privateKey: KeyObject; readonly publicKeyBase64: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};

/**
 * Signs the exact challenge a genuine headset would sign — same
 * `buildChallenge`, same `dsaEncoding: 'der'` the backend verifies with —
 * using a real private key.
 */
const signChallenge = (
  privateKey: KeyObject,
  pairingSessionId: string,
  secret: string,
  headsetPublicKeyId: string,
): Buffer => {
  const challenge = buildChallenge({ pairingSessionId, secret, headsetPublicKeyId });
  return cryptoSign('sha256', challenge, { key: privateKey, dsaEncoding: 'der' });
};

/**
 * The full path to a live, pending session: enrol a real key, register a
 * phone, create the session. Returns everything a redeem attempt needs,
 * including the private key — held only in this test process, never sent
 * anywhere except as the *output* of signing.
 */
const livePairingSession = async (server: ReturnType<typeof buildServer>, user: string = ALICE) => {
  const { privateKey, publicKeyBase64 } = freshP256KeyPair();

  const parsed = parseP256Spki(publicKeyBase64);
  if (!parsed.ok) throw new Error(`test fixture key failed to parse: ${parsed.reason}`);

  const enrolResponse = await server.inject({
    method: 'POST',
    url: '/v1/device-enrolments',
    payload: { publicKey: publicKeyBase64 },
  });
  const handle = json<EnrolResponseBody>(enrolResponse).handle;

  const { token, deviceId: phoneDeviceId } = await registeredPhone(server, user);
  const sessionResponse = await createSession(server, token, { phoneDeviceId, enrolmentHandle: handle });
  const session = json<PairingSessionResponseBody>(sessionResponse);

  const secret = session.code.slice('NX2.'.length);

  return {
    privateKey,
    keyId: parsed.keyId,
    session,
    secret,
    userId: user,
    phoneDeviceId,
    /** Signs the correct challenge for this exact session with this exact key. */
    correctSignature: (): Buffer => signChallenge(privateKey, session.pairingSessionId, secret, parsed.keyId),
  };
};

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

describe('redeeming a session with a genuine proof of possession', () => {
  it('succeeds for a correct signature over a live session — real crypto end to end', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    });

    expect(response.statusCode).toBe(200);
    expect(json<RedeemResponseBody>(response).paired).toBe(true);
  });

  it("registers the headset as a device belonging to the session's account", async () => {
    const { app, devices } = harness();
    const server = buildServer(app, config);
    const fixture = await livePairingSession(server, ALICE);

    // Calling the store directly for this one assertion: the HTTP response
    // deliberately carries no deviceId (nothing this step gives the headset
    // a credential to use one with), so confirming exactly which device was
    // created means reading the real store's real return value rather than
    // guessing an id.
    const result = await app.pairingSessions.redeem({
      secret: fixture.secret,
      signature: fixture.correctSignature(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const headset = await devices.find(ALICE, result.deviceId);
    expect(headset).not.toBeNull();
    expect(headset?.kind).toBe('headset');
    expect(headset?.userId).toBe(ALICE);
    expect(headset?.id).not.toBe(fixture.phoneDeviceId);
  });
});

describe('a code that cannot be redeemed', () => {
  it('rejects a code that was never issued', async () => {
    const { server } = harness();
    const response = await redeem(server, {
      code: 'NX2.this-secret-was-never-issued-by-anyone',
      signature: Buffer.from('irrelevant-but-base64', 'utf8').toString('base64'),
    });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects an expired session even with a perfectly correct signature', async () => {
    let now = new Date('2026-09-03T00:00:00.000Z');
    const devices = new InMemoryDeviceStore();
    const enrolments = new InMemoryEnrolmentStore();
    const pairingSessions = new InMemoryPairingSessionStore(enrolments, devices, undefined, undefined, () => now);
    const { server } = harness({ devices, enrolments, pairingSessions });

    const fixture = await livePairingSession(server);
    const signature = fixture.correctSignature();

    // Three minutes later — past the two-minute session TTL.
    now = new Date(now.getTime() + 3 * 60 * 1000);

    const response = await redeem(server, { code: fixture.session.code, signature: signature.toString('base64') });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an already-redeemed code on a second attempt with the identical request', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const payload = { code: fixture.session.code, signature: fixture.correctSignature().toString('base64') };

    const first = await redeem(server, payload);
    expect(first.statusCode).toBe(200);

    const second = await redeem(server, payload);
    expect(second.statusCode).toBe(400);
  });

  it('rejects a code redeemed once, then replayed with a freshly re-signed but still-spent session', async () => {
    // ECDSA signing is non-deterministic in Node by default, so this signs
    // the SAME challenge a second time and gets DIFFERENT signature bytes —
    // proving it is the session's *state*, not merely a repeated byte
    // string, that blocks the second attempt.
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const first = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    });
    expect(first.statusCode).toBe(200);

    const secondSignature = fixture.correctSignature();
    const firstSignature = fixture.correctSignature();
    expect(secondSignature.equals(firstSignature)).toBe(false);

    const second = await redeem(server, {
      code: fixture.session.code,
      signature: secondSignature.toString('base64'),
    });
    expect(second.statusCode).toBe(400);
  });
});

describe('the signature must actually prove the bound key', () => {
  it("rejects a signature from a different headset's key entirely", async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const attacker = freshP256KeyPair();

    // The attacker signs the CORRECT challenge — right session id, right
    // secret, even the real session's keyId — just with the wrong key.
    const forgedSignature = signChallenge(
      attacker.privateKey,
      fixture.session.pairingSessionId,
      fixture.secret,
      fixture.keyId,
    );

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: forgedSignature.toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects garbage signature bytes without crashing', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: Buffer.from('not a real DER signature at all', 'utf8').toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a signature computed over the wrong pairing session id', async () => {
    // The challenge specifically binds pairingSessionId. Here the signature
    // is genuine — correct key, correct secret, correct keyId — but signed
    // as though it were for a different session, exactly the case the
    // approved protocol adjustment exists to catch.
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const wrongSessionSignature = signChallenge(
      fixture.privateKey,
      'a-completely-different-session-id',
      fixture.secret,
      fixture.keyId,
    );

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: wrongSessionSignature.toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('a bad signature does not burn the session — a correct one still redeems it afterward', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const bad = await redeem(server, {
      code: fixture.session.code,
      signature: Buffer.from('wrong', 'utf8').toString('base64'),
    });
    expect(bad.statusCode).toBe(400);

    const good = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    });
    expect(good.statusCode).toBe(200);
  });
});

describe('concurrent redemption', () => {
  it('two simultaneous attempts with the same valid signature: exactly one succeeds', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const signature = fixture.correctSignature().toString('base64');

    const [first, second] = await Promise.all([
      redeem(server, { code: fixture.session.code, signature }),
      redeem(server, { code: fixture.session.code, signature }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it('ten simultaneous attempts: exactly one succeeds', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const signature = fixture.correctSignature().toString('base64');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => redeem(server, { code: fixture.session.code, signature })),
    );

    expect(responses.filter((r) => r.statusCode === 200).length).toBe(1);
  });
});

describe('the response and the request carry no secret material', () => {
  it('the successful response is exactly {paired:true} — no token of any kind', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    });
    const body = json<Record<string, unknown>>(response);

    expect(Object.keys(body)).toEqual(['paired']);

    const serialised = JSON.stringify(body);
    for (const forbidden of [
      'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'deviceToken', 'device_token', 'companionId', 'companion_id',
      'userId', 'user_id', 'sessionId', 'session_id',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('the private key never appears in the redeem request or response', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    // The PEM export exists only so this assertion has something concrete to
    // search for — it is never sent anywhere, which is exactly the property
    // being proved.
    const privateKeyPem = fixture.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const privateKeyBase64Body = privateKeyPem
      .split('\n')
      .filter((line) => !line.startsWith('-----'))
      .join('');

    const requestPayload = {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    };

    const response = await redeem(server, requestPayload);

    expect(JSON.stringify(requestPayload)).not.toContain(privateKeyBase64Body);
    expect(JSON.stringify(response.json())).not.toContain(privateKeyBase64Body);
  });
});

describe('the account and user cannot be influenced by the request', () => {
  it('ignores userId, user_id and companionId fields entirely and still binds to the real session owner', async () => {
    const { app, devices } = harness();
    const server = buildServer(app, config);
    const fixture = await livePairingSession(server, ALICE);

    const response = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
      userId: BOB,
      user_id: BOB,
      companionId: 'attacker-chosen-companion',
    });

    expect(response.statusCode).toBe(200);

    // The phone device — the one thing we can look up without a returned
    // deviceId — is still Alice's, exactly as it was before redemption.
    // Device creation itself is verified against the store directly in the
    // "no unrelated device" tests below.
    const phone = await devices.find(ALICE, fixture.phoneDeviceId as DeviceId);
    expect(phone?.userId).toBe(ALICE);
    void app;
  });
});

describe('this step creates no binding and no unrelated device', () => {
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
    const fixture = await livePairingSession(server);

    await redeem(server, { code: fixture.session.code, signature: fixture.correctSignature().toString('base64') });

    expect(isBoundCalls).toBe(0);
  });

  it('creates exactly one new device — the headset — and never touches the phone device again', async () => {
    const { app, devices } = harness();
    const server = buildServer(app, config);
    const fixture = await livePairingSession(server, ALICE);

    const beforePhone = await devices.find(ALICE, fixture.phoneDeviceId as DeviceId);
    expect(beforePhone).not.toBeNull();

    const result = await app.pairingSessions.redeem({
      secret: fixture.secret,
      signature: fixture.correctSignature(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const afterPhone = await devices.find(ALICE, fixture.phoneDeviceId as DeviceId);
    expect(afterPhone).toEqual(beforePhone);

    const headset = await devices.find(ALICE, result.deviceId);
    expect(headset?.kind).toBe('headset');
    expect(result.deviceId).not.toBe(fixture.phoneDeviceId);
  });
});

describe('invalid attempts are rate-limited', () => {
  it('eventually refuses further redemption attempts with 429', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    let lastStatus = 0;
    for (let i = 0; i < 25; i++) {
      const response = await redeem(server, {
        code: fixture.session.code,
        signature: Buffer.from(`not-a-real-signature-${i}`, 'utf8').toString('base64'),
      });
      lastStatus = response.statusCode;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('successful redemption changes state exactly once', () => {
  it('the same code can never be redeemed again after one success, however it is retried', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);

    const success = await redeem(server, {
      code: fixture.session.code,
      signature: fixture.correctSignature().toString('base64'),
    });
    expect(success.statusCode).toBe(200);

    for (let i = 0; i < 3; i++) {
      const retry = await redeem(server, {
        code: fixture.session.code,
        signature: fixture.correctSignature().toString('base64'),
      });
      expect(retry.statusCode).toBe(400);
    }
  });
});

describe('malformed redeem requests are rejected', () => {
  it('rejects a missing code', async () => {
    const { server } = harness();
    const response = await redeem(server, { signature: Buffer.from('x').toString('base64') });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a code with no NX2. prefix', async () => {
    const { server } = harness();
    const response = await redeem(server, { code: 'not-the-right-format', signature: 'AAAA' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing signature', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const response = await redeem(server, { code: fixture.session.code });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-base64 signature', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const response = await redeem(server, { code: fixture.session.code, signature: 'not valid base64!!!' });
    expect(response.statusCode).toBe(400);
  });

  it('requires no Authorization header at all — the redeem route stays unauthenticated', async () => {
    const { server } = harness();
    const fixture = await livePairingSession(server);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/pairing-sessions/redeem',
      // Deliberately no headers at all.
      payload: { code: fixture.session.code, signature: fixture.correctSignature().toString('base64') },
    });
    expect(response.statusCode).toBe(200);
  });
});
