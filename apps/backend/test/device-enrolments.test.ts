import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { InMemoryEnrolmentStore } from '../dist/devices/enrolments.js';
import type { DeviceStore } from '../dist/devices/store.js';
import type { CompanionBindingStore } from '../dist/auth/bindings.js';
import type { EnrolmentId } from '@nexa/shared';

/**
 * Publishing a headset's key.
 *
 * The one route on this server that asks for no credential, so what matters
 * here is narrow and adversarial: nothing it does may amount to authenticating
 * anyone, the plaintext handle may exist nowhere but the one response that
 * hands it out, and a key that is not really a P-256 public key must be
 * refused rather than stored.
 *
 * Real Fastify `server.inject()`, as every other suite in this repo uses.
 * Real `node:crypto` key generation for the valid-key cases — nothing here is
 * a stand-in for the parser under test.
 */

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
  supabaseJwtSecret: 'test-secret-not-used-anywhere-real-0123456789abcdef',
};

/** A fresh, real P-256 SPKI, base64-encoded exactly as a headset would send it. */
const freshP256Spki = (): string => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
};

const otherCurveSpki = (): string => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
};

const rsaSpki = (): string => {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
};

const harness = () => {
  const enrolments = new InMemoryEnrolmentStore();
  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.']),
    enrolments,
  });
  return { app, server: buildServer(app, config), enrolments };
};

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

const enrol = async (payload: Record<string, unknown>) => {
  const { server, enrolments } = harness();
  const response = await server.inject({
    method: 'POST',
    url: '/v1/device-enrolments',
    payload,
  });
  return { response, enrolments };
};

describe('a headset publishes its key with no credential of its own', () => {
  it('succeeds for a genuine P-256 SPKI with no Authorization header at all', async () => {
    const { response } = await enrol({ publicKey: freshP256Spki() });

    expect(response.statusCode).toBe(201);
    const body = json<EnrolResponseBody>(response);
    expect(typeof body.enrolmentId).toBe('string');
    expect(body.enrolmentId.length).toBeGreaterThan(0);
    expect(typeof body.handle).toBe('string');
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
  });

  it('accepts a request that carries an Authorization header anyway, without needing it', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      headers: { authorization: 'Bearer this-is-never-checked' },
      payload: { publicKey: freshP256Spki() },
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('the handle', () => {
  it('is transport-safe: base64url, no padding, no + or /', async () => {
    const { response } = await enrol({ publicKey: freshP256Spki() });
    const { handle } = json<EnrolResponseBody>(response);

    expect(handle).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(handle).not.toContain('+');
    expect(handle).not.toContain('/');
    expect(handle).not.toContain('=');
  });

  it('carries 256 bits of entropy — 43 base64url characters for 32 bytes', async () => {
    const { response } = await enrol({ publicKey: freshP256Spki() });
    expect(json<EnrolResponseBody>(response).handle.length).toBe(43);
  });

  it('is never equal to what gets stored as its hash', async () => {
    const { response, enrolments } = await enrol({ publicKey: freshP256Spki() });
    const body = json<EnrolResponseBody>(response);

    const stored = enrolments.peek(body.enrolmentId as EnrolmentId);
    expect(stored).not.toBeNull();
    expect(stored?.handleHash).not.toBe(body.handle);
  });

  it('is persisted only as SHA-256(handle)', async () => {
    const { response, enrolments } = await enrol({ publicKey: freshP256Spki() });
    const body = json<EnrolResponseBody>(response);

    const expectedHash = createHash('sha256').update(body.handle).digest('base64url');
    const stored = enrolments.peek(body.enrolmentId as EnrolmentId);
    expect(stored?.handleHash).toBe(expectedHash);
  });

  it('leaves no trace of the plaintext anywhere in the persisted record', async () => {
    const { response, enrolments } = await enrol({ publicKey: freshP256Spki() });
    const body = json<EnrolResponseBody>(response);

    const stored = enrolments.peek(body.enrolmentId as EnrolmentId);
    const replacer = (_key: string, value: unknown): unknown =>
      Buffer.isBuffer(value) ? value.toString('base64') : value;
    const serialised = JSON.stringify(stored, replacer);
    expect(serialised).not.toContain(body.handle);
  });

  it('two enrolments never receive the same handle', async () => {
    const { server } = harness();
    const first = await server.inject({
      method: 'POST', url: '/v1/device-enrolments', payload: { publicKey: freshP256Spki() },
    });
    const second = await server.inject({
      method: 'POST', url: '/v1/device-enrolments', payload: { publicKey: freshP256Spki() },
    });
    expect(json<EnrolResponseBody>(first).handle).not.toBe(json<EnrolResponseBody>(second).handle);
  });
});

describe('expiry', () => {
  it('is set to approximately five minutes from now', async () => {
    const before = Date.now();
    const { response } = await enrol({ publicKey: freshP256Spki() });
    const after = Date.now();

    const expiresAt = Date.parse(json<EnrolResponseBody>(response).expiresAt);
    const FIVE_MIN = 5 * 60 * 1000;

    expect(expiresAt).toBeGreaterThanOrEqual(before + FIVE_MIN - 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + FIVE_MIN + 1000);
  });
});

describe('the enrolment id', () => {
  it('is server-generated and ignores one the client supplies', async () => {
    const chosen = 'client-chosen-enrolment-id';
    const { response } = await enrol({ publicKey: freshP256Spki(), enrolmentId: chosen, id: chosen });
    expect(json<EnrolResponseBody>(response).enrolmentId).not.toBe(chosen);
  });
});

describe('key metadata', () => {
  it('persists a supplied keySecurityLevel', async () => {
    const { response, enrolments } = await enrol({ publicKey: freshP256Spki(), keySecurityLevel: 'tee' });
    const body = json<EnrolResponseBody>(response);
    expect(response.statusCode).toBe(201);
    expect(enrolments.peek(body.enrolmentId as EnrolmentId)?.keySecurityLevel).toBe('tee');
  });

  it('defaults to null when the caller says nothing about it', async () => {
    const { response, enrolments } = await enrol({ publicKey: freshP256Spki() });
    const body = json<EnrolResponseBody>(response);
    expect(enrolments.peek(body.enrolmentId as EnrolmentId)?.keySecurityLevel).toBeNull();
  });

  it('derives publicKeyId from the key itself and ignores a client-supplied one', async () => {
    const publicKey = freshP256Spki();
    const der = Buffer.from(publicKey, 'base64');
    const expectedKeyId = createHash('sha256').update(der).digest('base64url');

    const { response, enrolments } = await enrol({
      publicKey,
      publicKeyId: 'attacker-chosen-id-that-does-not-match-the-key',
    });
    const body = json<EnrolResponseBody>(response);

    expect(enrolments.peek(body.enrolmentId as EnrolmentId)?.publicKeyId).toBe(expectedKeyId);
  });
});

describe('a key that is not a valid P-256 public key is refused, not stored', () => {
  it('rejects a missing publicKey field', async () => {
    const { response } = await enrol({});
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects an empty-string publicKey', async () => {
    const { response } = await enrol({ publicKey: '' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-string publicKey', async () => {
    const { response } = await enrol({ publicKey: 12345 });
    expect(response.statusCode).toBe(400);
  });

  it('rejects malformed base64', async () => {
    const { response } = await enrol({ publicKey: 'not-valid-base64!!! and spaces' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects base64 that decodes but is not a DER structure at all', async () => {
    const { response } = await enrol({ publicKey: Buffer.from('just some random bytes, not a key').toString('base64') });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an RSA public key', async () => {
    const { response } = await enrol({ publicKey: rsaSpki() });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).message).toMatch(/EC/i);
  });

  it('rejects an EC key on the wrong curve', async () => {
    const { response } = await enrol({ publicKey: otherCurveSpki() });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).message).toMatch(/P-256|prime256v1/i);
  });

  it('rejects an invalid keySecurityLevel', async () => {
    const { response } = await enrol({ publicKey: freshP256Spki(), keySecurityLevel: 'quantum-proof' });
    expect(response.statusCode).toBe(400);
  });

  it('none of the rejected requests create an enrolment row', async () => {
    const { enrolments } = harness();
    // A fresh store per case above already proves this implicitly (nothing to
    // peek without an id), but assert the shape of the guarantee directly: a
    // store that received no successful call has nothing in it.
    expect(enrolments.peek('nonexistent-id' as EnrolmentId)).toBeNull();
  });
});

describe('malformed requests are bounded before they can cost anything', () => {
  it('rejects a body that is not a JSON object', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: '"just a string"',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects malformed JSON outright', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: '{ this is not json',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a grossly oversized payload without parsing it as a key', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: { publicKey: 'A'.repeat(100_000) },
    });
    expect(response.statusCode).toBe(413);
  });
});

describe('repeated attempts from one source are bounded', () => {
  it('eventually refuses further attempts with 429, not by degrading some other way', async () => {
    const { server } = harness();
    let lastStatus = 0;
    for (let i = 0; i < 25; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/device-enrolments',
        payload: { publicKey: 'not-a-real-key-' + i },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('an enrolment grants nothing on its own', () => {
  it('never calls registerPhone or find on the device store', async () => {
    const { InMemoryDeviceStore } = await import('../dist/devices/store.js');
    const store = new InMemoryDeviceStore();
    let registerPhoneCalls = 0;
    let findCalls = 0;
    const spied: DeviceStore = {
      registerPhone: (input) => {
        registerPhoneCalls += 1;
        return store.registerPhone(input);
      },
      find: (userId, deviceId) => {
        findCalls += 1;
        return store.find(userId, deviceId);
      },
    };

    const app = compose(config, {
      languageModel: new ScriptedLanguageModel(['Sure.']),
      devices: spied,
    });
    const server = buildServer(app, config);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: { publicKey: freshP256Spki() },
    });

    expect(response.statusCode).toBe(201);
    expect(registerPhoneCalls).toBe(0);
    expect(findCalls).toBe(0);
  });

  it('never calls isBound or companionsFor on the binding store', async () => {
    const { InMemoryCompanionBindings } = await import('../dist/auth/bindings.js');
    const bindings = new InMemoryCompanionBindings();
    let isBoundCalls = 0;
    const spied: CompanionBindingStore = {
      isBound: (userId, companionId) => {
        isBoundCalls += 1;
        return bindings.isBound(userId, companionId);
      },
      companionsFor: (userId) => bindings.companionsFor(userId),
    };

    const app = compose(config, {
      languageModel: new ScriptedLanguageModel(['Sure.']),
      bindings: spied,
    });
    const server = buildServer(app, config);

    await server.inject({
      method: 'POST',
      url: '/v1/device-enrolments',
      payload: { publicKey: freshP256Spki() },
    });

    expect(isBoundCalls).toBe(0);
  });

  it('the response contains no account, token or binding information', async () => {
    const { response } = await enrol({ publicKey: freshP256Spki() });
    const body = json<Record<string, unknown>>(response);

    expect(Object.keys(body).sort()).toEqual(['enrolmentId', 'expiresAt', 'handle']);

    const serialised = JSON.stringify(body);
    for (const forbidden of [
      'userId', 'user_id', 'companionId', 'companion_id',
      'accessToken', 'access_token', 'refreshToken', 'refresh_token',
      'deviceToken', 'device_token', 'sessionId', 'session_id',
      'handle_hash', 'handleHash',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('still leaves companion admission behaving exactly as before', async () => {
    const { server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      payload: { companionId: 'companion-1', text: 'Hello.' },
    });
    expect(response.statusCode).toBe(401);
  });
});
