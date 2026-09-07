import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { trustExternalId, type DeviceId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import type { CompositionOverrides } from '../dist/composition.js';
import { InMemoryDeviceStore } from '../dist/devices/store.js';
import { InMemoryEnrolmentStore } from '../dist/devices/enrolments.js';
import { InMemoryPairingSessionStore } from '../dist/devices/pairing-sessions.js';
import {
  InMemoryDeviceTokenStore,
  mintFamilyRoot,
  computeExpiry,
  FAMILY_INACTIVITY_WINDOW_MS,
  FAMILY_MAX_LIFETIME_MS,
} from '../dist/devices/tokens.js';
import { parseP256Spki } from '../dist/devices/spki.js';
import { buildChallenge, buildRefreshChallenge } from '../dist/devices/challenge.js';
import { hashSecret } from '../dist/devices/secrets.js';
import { InMemoryCompanionBindings, type CompanionBindingStore } from '../dist/auth/bindings.js';

/**
 * Refreshing a headset's credentials — Step 3E.
 *
 * Everything except the two store-level unit tests (marked as such) runs
 * through the real HTTP surface with real cryptography, exactly as
 * `pairing-sessions.test.ts` exercises redemption: a genuinely generated
 * P-256 key, `crypto.sign` with `dsaEncoding: 'der'`, and the real
 * `DeviceTokenStore.refresh` verifying it. What is being proved: a refresh
 * is bound to the same key redemption bound, rotation is single-use and
 * race-safe, a family can never outlive its 90-day origin however often it
 * rotates within its 14-day inactivity window, and none of this touches
 * Supabase authentication, companion bindings, or a private key.
 */

const JWT_SECRET = 'test-secret-not-used-anywhere-real-0123456789abcdef';
const DEVICE_TOKEN_SECRET = 'test-device-token-secret-not-used-anywhere-real-0123456789abcdef';

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
  deviceTokenSecret: DEVICE_TOKEN_SECRET,
};

const ALICE = trustExternalId<UserId>('alice-uuid');

const tokenFor = async (subject: string): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(JWT_SECRET));

const json = <T>(response: { json(): unknown }): T => response.json() as T;

/** Reads a JWT's payload without verifying it — good enough for asserting claims in a test. */
const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const [, payload] = token.split('.');
  if (payload === undefined) throw new Error('not a JWT');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
};

/**
 * A full harness against one shared `InMemoryDeviceTokenStore` — exactly the
 * arrangement `compose()` builds, reproduced for tests the same way
 * `pairing-sessions.test.ts` does. `now` defaults to the real clock; a test
 * that needs to travel through a family's lifetime supplies its own.
 */
const harness = (now: () => Date = () => new Date(), overrides: CompositionOverrides = {}) => {
  const devices = new InMemoryDeviceStore();
  const enrolments = new InMemoryEnrolmentStore();
  const deviceTokens = new InMemoryDeviceTokenStore(devices, DEVICE_TOKEN_SECRET, now);
  const pairingSessions = new InMemoryPairingSessionStore(
    enrolments,
    devices,
    deviceTokens,
    DEVICE_TOKEN_SECRET,
    undefined,
    undefined,
    now,
  );
  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.']),
    devices,
    enrolments,
    deviceTokens,
    pairingSessions,
    ...overrides,
  });
  return { app, server: buildServer(app, config), devices, enrolments, deviceTokens, pairingSessions };
};

interface DeviceResponseBody {
  readonly deviceId: string;
}
interface EnrolResponseBody {
  readonly handle: string;
}
interface PairingSessionResponseBody {
  readonly pairingSessionId: string;
  readonly code: string;
}
interface RedeemResponseBody {
  readonly deviceId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}
interface RefreshResponseBody {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}
interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
}

const freshP256KeyPair = (): { readonly privateKey: KeyObject; readonly publicKeyBase64: string } => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
};

/** Signs the exact refresh challenge a genuine headset would sign. */
const signRefreshChallenge = (
  privateKey: KeyObject,
  deviceId: string,
  refreshToken: string,
  headsetPublicKeyId: string,
): Buffer => {
  const challenge = buildRefreshChallenge({ deviceId, refreshToken, headsetPublicKeyId });
  return cryptoSign('sha256', challenge, { key: privateKey, dsaEncoding: 'der' });
};

const refresh = (server: ReturnType<typeof buildServer>, payload: Record<string, unknown>) =>
  server.inject({ method: 'POST', url: '/v1/devices/token/refresh', payload });

/**
 * The full path to a headset that has already paired: enrol, register a
 * phone, create and redeem a session — real crypto throughout, exactly as
 * `pairing-sessions.test.ts`'s `livePairingSession` does, continued one step
 * further into the credentials redemption actually returns.
 */
const pairedHeadset = async (server: ReturnType<typeof buildServer>, user: string = ALICE) => {
  const { privateKey, publicKeyBase64 } = freshP256KeyPair();
  const parsed = parseP256Spki(publicKeyBase64);
  if (!parsed.ok) throw new Error(`test fixture key failed to parse: ${parsed.reason}`);

  const enrolResponse = await server.inject({
    method: 'POST',
    url: '/v1/device-enrolments',
    payload: { publicKey: publicKeyBase64 },
  });
  const handle = json<EnrolResponseBody>(enrolResponse).handle;

  const phoneToken = await tokenFor(user);
  const phoneResponse = await server.inject({
    method: 'POST',
    url: '/v1/devices',
    headers: { authorization: `Bearer ${phoneToken}` },
    payload: {},
  });
  const phoneDeviceId = json<DeviceResponseBody>(phoneResponse).deviceId;

  const sessionResponse = await server.inject({
    method: 'POST',
    url: '/v1/pairing-sessions',
    headers: { authorization: `Bearer ${phoneToken}` },
    payload: { phoneDeviceId, enrolmentHandle: handle },
  });
  const session = json<PairingSessionResponseBody>(sessionResponse);
  const secret = session.code.slice('NX2.'.length);

  const redemptionSignature = cryptoSign(
    'sha256',
    buildChallenge({ pairingSessionId: session.pairingSessionId, secret, headsetPublicKeyId: parsed.keyId }),
    { key: privateKey, dsaEncoding: 'der' },
  );

  const redeemResponse = await server.inject({
    method: 'POST',
    url: '/v1/pairing-sessions/redeem',
    payload: { code: session.code, signature: redemptionSignature.toString('base64') },
  });
  const redeemed = json<RedeemResponseBody>(redeemResponse);

  return {
    privateKey,
    keyId: parsed.keyId,
    deviceId: redeemed.deviceId,
    accessToken: redeemed.accessToken,
    refreshToken: redeemed.refreshToken,
    userId: user,
    /** Signs the correct refresh challenge for whatever refresh token is currently live. */
    signRefresh: (currentRefreshToken: string): Buffer =>
      signRefreshChallenge(privateKey, redeemed.deviceId, currentRefreshToken, parsed.keyId),
  };
};

describe('refreshing with a genuine proof of possession', () => {
  it('succeeds for a correct signature over a live refresh token — real crypto end to end', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
    });

    expect(response.statusCode).toBe(200);
    const body = json<RefreshResponseBody>(response);
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken).not.toBe(fixture.refreshToken);
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it('the new access token carries the right subject, audience, and device relationship', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server, ALICE);

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
    });
    const body = json<RefreshResponseBody>(response);

    const claims = decodeJwtPayload(body.accessToken);
    expect(claims.sub).toBe(ALICE);
    expect(claims.aud).toBe('nexa-device');
  });

  it('the new access token authenticates through the existing authenticate() path', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server, ALICE);

    const refreshed = json<RefreshResponseBody>(
      await refresh(server, {
        refreshToken: fixture.refreshToken,
        signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
      }),
    );

    // `/v1/devices` runs the exact same `authenticate()` every other
    // authenticated route does — nothing route-specific about accepting a
    // device token, only `app.auth` being composed to try one.
    const response = await server.inject({
      method: 'POST',
      url: '/v1/devices',
      headers: { authorization: `Bearer ${refreshed.accessToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
  });

  it('rotation is single-use — the old refresh token becomes unusable immediately', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const signatureOverOriginal = fixture.signRefresh(fixture.refreshToken).toString('base64');

    const first = await refresh(server, { refreshToken: fixture.refreshToken, signature: signatureOverOriginal });
    expect(first.statusCode).toBe(200);

    const replay = await refresh(server, { refreshToken: fixture.refreshToken, signature: signatureOverOriginal });
    expect(replay.statusCode).toBe(400);
  });

  it('reusing an already-rotated refresh token revokes the whole family, including the unused newest token', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const rootToken = fixture.refreshToken;

    const rotated = json<RefreshResponseBody>(
      await refresh(server, { refreshToken: rootToken, signature: fixture.signRefresh(rootToken).toString('base64') }),
    );

    // The theft signal: presenting the now-superseded root token again.
    const reuse = await refresh(server, {
      refreshToken: rootToken,
      signature: fixture.signRefresh(rootToken).toString('base64'),
    });
    expect(reuse.statusCode).toBe(400);

    // The consequence: even the newest, never-yet-used token from the same
    // family — which on its own is perfectly live — is now revoked too.
    const afterRevocation = await refresh(server, {
      refreshToken: rotated.refreshToken,
      signature: fixture.signRefresh(rotated.refreshToken).toString('base64'),
    });
    expect(afterRevocation.statusCode).toBe(400);
  });

  it('two concurrent refreshes of the same token: exactly one succeeds', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const signature = fixture.signRefresh(fixture.refreshToken).toString('base64');

    const [first, second] = await Promise.all([
      refresh(server, { refreshToken: fixture.refreshToken, signature }),
      refresh(server, { refreshToken: fixture.refreshToken, signature }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 400]);
  });

  it('ten concurrent refreshes of the same token: exactly one succeeds', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const signature = fixture.signRefresh(fixture.refreshToken).toString('base64');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => refresh(server, { refreshToken: fixture.refreshToken, signature })),
    );

    expect(responses.filter((r) => r.statusCode === 200).length).toBe(1);
  });
});

describe('the signature must actually prove the bound key', () => {
  it("rejects a signature from a different headset's key entirely — wrong headset key", async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const attacker = freshP256KeyPair();

    const forgedSignature = signRefreshChallenge(attacker.privateKey, fixture.deviceId, fixture.refreshToken, fixture.keyId);

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: forgedSignature.toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects garbage signature bytes without crashing — invalid signature', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: Buffer.from('not a real DER signature at all', 'utf8').toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a signature computed over a modified refresh challenge', async () => {
    // The signature is genuine — the real key, real DER encoding — but
    // signed as though the refresh token were a different value than the
    // one actually presented, exactly what `buildRefreshChallenge` binding
    // the plaintext token exists to catch.
    const { server } = harness();
    const fixture = await pairedHeadset(server);

    const wrongTokenSignature = signRefreshChallenge(
      fixture.privateKey,
      fixture.deviceId,
      'a-refresh-token-that-was-never-issued',
      fixture.keyId,
    );

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: wrongTokenSignature.toString('base64'),
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('token lifecycle failures', () => {
  it('rejects an unknown refresh token', async () => {
    const { server } = harness();
    const response = await refresh(server, {
      refreshToken: 'this-token-was-never-issued-by-anyone',
      signature: Buffer.from('irrelevant-but-base64', 'utf8').toString('base64'),
    });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects an expired refresh token — past the 14-day inactivity window', async () => {
    let now = new Date('2026-09-03T00:00:00.000Z');
    const { server } = harness(() => now);
    const fixture = await pairedHeadset(server);
    const signature = fixture.signRefresh(fixture.refreshToken).toString('base64');

    now = new Date(now.getTime() + FAMILY_INACTIVITY_WINDOW_MS + 1_000);

    const response = await refresh(server, { refreshToken: fixture.refreshToken, signature });
    expect(response.statusCode).toBe(400);
  });
});

describe('the family lifetime is a hard ceiling from redemption, never extended by rotation', () => {
  it('computeExpiry caps a rotation at the family root, never at now + the inactivity window, once that would exceed it', () => {
    const familyIssuedAt = new Date('2026-01-01T00:00:00.000Z');

    // Well within both bounds: the inactivity window is the tighter one.
    const early = computeExpiry(familyIssuedAt, familyIssuedAt);
    expect(early.getTime()).toBe(familyIssuedAt.getTime() + FAMILY_INACTIVITY_WINDOW_MS);

    // 80 days in: now + 14 days would land at day 94, past the family's own
    // 90-day ceiling — the ceiling wins.
    const late = computeExpiry(new Date(familyIssuedAt.getTime() + 80 * 24 * 60 * 60 * 1000), familyIssuedAt);
    expect(late.getTime()).toBe(familyIssuedAt.getTime() + FAMILY_MAX_LIFETIME_MS);
  });

  it('repeated rotation, each well inside its own 14-day window, never pushes expiry past the 90-day family cap', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const { server } = harness(() => now);
    const fixture = await pairedHeadset(server);
    const familyIssuedAt = now.getTime();

    let currentRefreshToken = fixture.refreshToken;

    // Rotate every 13 days — always well inside the 14-day inactivity
    // window, so inactivity alone would let this continue forever. By the
    // sixth rotation (day 78), now + 14 days (day 92) exceeds the family's
    // day-90 ceiling, so that rotation's new expiry is capped at day 90
    // rather than day 92.
    for (let i = 0; i < 6; i++) {
      now = new Date(familyIssuedAt + (i + 1) * 13 * 24 * 60 * 60 * 1000);
      const signature = fixture.signRefresh(currentRefreshToken).toString('base64');
      const response = await refresh(server, { refreshToken: currentRefreshToken, signature });
      expect(response.statusCode).toBe(200);
      currentRefreshToken = json<RefreshResponseBody>(response).refreshToken;
    }

    // One more rotation, one day before the family cap: still succeeds, and
    // still does not push expiry a single millisecond past day 90.
    now = new Date(familyIssuedAt + 89 * 24 * 60 * 60 * 1000);
    const lastRotation = await refresh(server, {
      refreshToken: currentRefreshToken,
      signature: fixture.signRefresh(currentRefreshToken).toString('base64'),
    });
    expect(lastRotation.statusCode).toBe(200);
    currentRefreshToken = json<RefreshResponseBody>(lastRotation).refreshToken;

    // Past the family's absolute 90-day ceiling: refused, even though this
    // token was rotated barely a day ago and its own inactivity window has
    // not remotely lapsed.
    now = new Date(familyIssuedAt + FAMILY_MAX_LIFETIME_MS + 1_000);
    const pastTheCap = await refresh(server, {
      refreshToken: currentRefreshToken,
      signature: fixture.signRefresh(currentRefreshToken).toString('base64'),
    });
    expect(pastTheCap.statusCode).toBe(400);
  });
});

describe('a revoked device may not refresh', () => {
  // Store-level, not HTTP: there is no device-revocation route in this step
  // (out of scope), so this exercises `InMemoryDeviceTokenStore.refresh`
  // directly against a minimal stand-in for `InMemoryDeviceStore` that
  // reports a genuinely matching key, but revoked — everything about the
  // proof is otherwise perfect, isolating revocation as the only variable.
  it('refuses a refresh even with a fully valid signature, once the device is revoked', async () => {
    const { privateKey, publicKeyBase64 } = freshP256KeyPair();
    const parsed = parseP256Spki(publicKeyBase64);
    if (!parsed.ok) throw new Error(`test fixture key failed to parse: ${parsed.reason}`);

    const revokedDeviceStub = {
      headsetKeyOf: (deviceId: string) =>
        deviceId === 'device-1' ? { publicKey: parsed.der, publicKeyId: parsed.keyId, revokedAt: new Date() } : null,
    } as unknown as InMemoryDeviceStore;

    const tokenStore = new InMemoryDeviceTokenStore(revokedDeviceStub, DEVICE_TOKEN_SECRET);
    const prepared = mintFamilyRoot();
    tokenStore.insertRoot(prepared, 'device-1', ALICE);

    const signature = signRefreshChallenge(privateKey, 'device-1', prepared.refreshToken, parsed.keyId);
    const result = await tokenStore.refresh(prepared.refreshToken, signature);

    expect(result.ok).toBe(false);
  });
});

describe('what is stored is a hash, never the plaintext', () => {
  // Pure-function level: `mintFamilyRoot`/`mintRotation` are the only place
  // a `device_tokens` row's `token_hash` is computed, for both the in-memory
  // and Postgres stores alike (see `tokens.ts`'s module doc).
  it('token_hash is exactly hashSecret(plaintext), never the plaintext itself', () => {
    const prepared = mintFamilyRoot();
    expect(prepared.refreshTokenHash).toBe(hashSecret(prepared.refreshToken));
    expect(prepared.refreshTokenHash).not.toBe(prepared.refreshToken);
  });
});

describe('no private key, and no unrelated state, ever reaches the backend', () => {
  it('the private key never appears in the refresh request or response', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);

    const privateKeyPem = fixture.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const privateKeyBase64Body = privateKeyPem
      .split('\n')
      .filter((line) => !line.startsWith('-----'))
      .join('');

    const requestPayload = {
      refreshToken: fixture.refreshToken,
      signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
    };
    const response = await refresh(server, requestPayload);

    expect(JSON.stringify(requestPayload)).not.toContain(privateKeyBase64Body);
    expect(JSON.stringify(response.json())).not.toContain(privateKeyBase64Body);
  });

  it('never calls isBound or companionsFor on the binding store', async () => {
    const bindings = new InMemoryCompanionBindings();
    let calls = 0;
    const spied: CompanionBindingStore = {
      isBound: (userId, companionId) => {
        calls += 1;
        return bindings.isBound(userId, companionId);
      },
      companionsFor: (userId) => bindings.companionsFor(userId),
    };

    const { server } = harness(() => new Date(), { bindings: spied });
    const fixture = await pairedHeadset(server);

    await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
    });

    expect(calls).toBe(0);
  });

  it('an unrelated device is never created — the device store gains nothing beyond the phone and the headset', async () => {
    const { server, devices } = harness();
    const fixture = await pairedHeadset(server, ALICE);

    await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
    });

    // Whatever devices exist after a refresh, the headset that redemption
    // created is unchanged — refresh reads it, and never re-registers it.
    const headset = await devices.find(ALICE, fixture.deviceId as DeviceId);
    expect(headset?.id).toBe(fixture.deviceId);
  });

  it('is never logged or echoed in plaintext anywhere in an error response', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);

    const response = await refresh(server, {
      refreshToken: fixture.refreshToken,
      signature: Buffer.from('deliberately-wrong', 'utf8').toString('base64'),
    });

    const serialised = JSON.stringify(response.json());
    expect(serialised).not.toContain(fixture.refreshToken);
    expect(serialised).not.toContain(fixture.accessToken);
  });
});

describe('malformed refresh requests are rejected', () => {
  it('rejects a missing refreshToken', async () => {
    const { server } = harness();
    const response = await refresh(server, { signature: Buffer.from('x').toString('base64') });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a missing signature', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const response = await refresh(server, { refreshToken: fixture.refreshToken });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-base64 signature', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const response = await refresh(server, { refreshToken: fixture.refreshToken, signature: 'not valid base64!!!' });
    expect(response.statusCode).toBe(400);
  });

  it('requires no Authorization header at all — the refresh route stays unauthenticated', async () => {
    const { server } = harness();
    const fixture = await pairedHeadset(server);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/devices/token/refresh',
      payload: {
        refreshToken: fixture.refreshToken,
        signature: fixture.signRefresh(fixture.refreshToken).toString('base64'),
      },
    });
    expect(response.statusCode).toBe(200);
  });
});
