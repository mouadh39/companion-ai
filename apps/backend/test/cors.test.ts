import { describe, expect, it } from 'vitest';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { corsPolicy, parseCorsOrigins } from '../dist/cors.js';
import { TEST_JWT_SECRET, authHeaders } from './support/auth.js';

/**
 * CORS for the browser client (Flutter Web).
 *
 * Two halves: the origin policy in isolation (`cors.ts`), and the same policy
 * over the real HTTP surface (`buildServer` + `@fastify/cors`), proving a
 * preflight is answered before authentication and that authenticated `/v1/*`
 * requests are unchanged apart from gaining the allow-origin header.
 */

const ALLOWED = 'https://app.nexa.example';

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
  supabaseJwtSecret: TEST_JWT_SECRET,
  deviceTokenSecret: null,
  corsOrigins: [ALLOWED, 'http://localhost:*'],
};

const serverWith = (corsOrigins: readonly string[] = config.corsOrigins ?? []) => {
  const app = compose(
    { ...config, corsOrigins },
    {
      clock: new FixedClock(new Date('2026-07-29T12:00:00.000Z')),
      languageModel: new ScriptedLanguageModel(['ok']),
    },
  );
  return buildServer(app, { ...config, corsOrigins });
};

describe('the origin policy', () => {
  it('allows an exactly configured origin and nothing near it', () => {
    const policy = corsPolicy([ALLOWED]);
    expect(policy.allows(ALLOWED)).toBe(true);
    expect(policy.allows('https://app.nexa.example.evil.com')).toBe(false);
    expect(policy.allows('http://app.nexa.example')).toBe(false); // scheme differs
  });

  it('allows any port on a configured loopback host, and only a real port', () => {
    const policy = corsPolicy(['http://localhost:*', 'http://127.0.0.1:*']);
    expect(policy.allows('http://localhost:1234')).toBe(true);
    expect(policy.allows('http://localhost:59321')).toBe(true);
    expect(policy.allows('http://127.0.0.1:8080')).toBe(true);
    expect(policy.allows('http://localhost')).toBe(false); // no port
    expect(policy.allows('http://localhost:abc')).toBe(false); // not a port
    expect(policy.allows('http://localhost.evil.com:3000')).toBe(false);
    expect(policy.allows('https://localhost:3000')).toBe(false); // scheme differs
  });

  it("refuses a ':*' wildcard for anything but a loopback host", () => {
    expect(() => corsPolicy(['https://anything.example:*'])).toThrow();
    expect(() => corsPolicy(['http://10.0.0.5:*'])).toThrow();
    expect(() => corsPolicy(['http://localhost.evil.com:*'])).toThrow();
  });

  it('is empty when nothing is configured', () => {
    expect(corsPolicy([]).isEmpty).toBe(true);
    expect(corsPolicy([]).allows(ALLOWED)).toBe(false);
  });

  it('parses NEXA_CORS_ORIGINS, trimming blanks', () => {
    expect(parseCorsOrigins(' a , ,  b ,')).toEqual(['a', 'b']);
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins(undefined)).toEqual([]);
  });
});

describe('CORS over the real HTTP surface', () => {
  it('an allowed origin gets Access-Control-Allow-Origin on a normal request', async () => {
    const server = serverWith();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(String(response.headers['vary'] ?? '')).toContain('Origin');
  });

  it('a disallowed origin gets no Access-Control-Allow-Origin (the browser blocks the read)', async () => {
    const server = serverWith();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://evil.example' },
    });

    // The request is still served — CORS is not server-side access control —
    // but the browser will refuse to hand the response to the page.
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers an OPTIONS preflight before authentication, with the method and header allowances', async () => {
    const server = serverWith();

    const response = await server.inject({
      method: 'OPTIONS',
      url: '/v1/profile',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    // Not a 401 (auth never ran) and not a 404 (no OPTIONS route is registered).
    expect(response.statusCode).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(String(response.headers['access-control-allow-methods'])).toContain('PATCH');
    expect(String(response.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'authorization',
    );
  });

  it('a preflight from a disallowed origin carries no CORS headers', async () => {
    const server = serverWith();

    const response = await server.inject({
      method: 'OPTIONS',
      url: '/v1/profile',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PATCH' },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a local Flutter Web dev origin on a random port is allowed', async () => {
    const server = serverWith();

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'http://localhost:57318' },
    });

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:57318');
  });

  it('an authenticated /v1/profile request still authenticates, and carries the allow-origin header', async () => {
    const server = serverWith();

    // No token: still 401, exactly as before — but now with the CORS header so
    // the browser can read the 401 body instead of a generic network error.
    const anonymous = await server.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { origin: ALLOWED },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers['access-control-allow-origin']).toBe(ALLOWED);

    // A real token: authenticates and answers, with the CORS header.
    const authed = await server.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { ...(await authHeaders('cors-user')), origin: ALLOWED },
    });
    expect(authed.statusCode).toBe(200);
    expect(authed.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('a request with no Origin header is untouched — no CORS headers, normal response', async () => {
    const server = serverWith();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('with nothing configured, no origin is allowed — the prior behaviour', async () => {
    const server = serverWith([]);

    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: ALLOWED },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
