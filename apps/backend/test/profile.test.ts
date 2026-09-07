import { describe, expect, it } from 'vitest';
import { FixedClock, trustExternalId, type UserId } from '@nexa/shared';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { buildServer } from '../dist/server.js';
import type { AppConfig } from '../dist/config.js';
import { InMemoryProfileStore } from '../dist/profile/store.js';
import { authHeaders } from './support/auth.js';

/**
 * Onboarding's own storage: what an account has told Nexa about itself.
 *
 * Goes through the real HTTP surface and the real Supabase verifier, exactly
 * as `devices.test.ts` does — nothing stubbed here except the language model,
 * which no profile route touches.
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
  deviceTokenSecret: null,
};

const ALICE = trustExternalId<UserId>('alice-uuid');
const BOB = trustExternalId<UserId>('bob-uuid');

/** 2024-06-15, arbitrary but fixed — every age assertion is relative to this. */
const NOW = new FixedClock(Date.UTC(2024, 5, 15));

const harness = () => {
  const profiles = new InMemoryProfileStore(() => new Date(NOW.now()));
  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.']),
    profiles,
    clock: NOW,
  });
  return { server: buildServer(app, config), profiles };
};

interface ProfileResponseBody {
  readonly firstName: string | null;
  readonly username: string | null;
  readonly dateOfBirth: string | null;
  readonly completed: boolean;
}

interface ErrorResponseBody {
  readonly error: string;
  readonly message: string;
}

const json = <T>(response: { json(): unknown }): T => response.json() as T;

const get = async (subject: string | null) => {
  const { server, profiles } = harness();
  const response = await server.inject({
    method: 'GET',
    url: '/v1/profile',
    ...(subject === null ? {} : { headers: await authHeaders(subject) }),
  });
  return { response, profiles };
};

const patch = async (
  subject: string | null,
  payload: Record<string, unknown>,
  existing?: { readonly server: ReturnType<typeof harness>['server']; readonly profiles: InMemoryProfileStore },
) => {
  const { server, profiles } = existing ?? harness();
  const response = await server.inject({
    method: 'PATCH',
    url: '/v1/profile',
    ...(subject === null ? {} : { headers: await authHeaders(subject) }),
    payload,
  });
  return { response, profiles, server };
};

describe('a profile belongs to whoever proved they own it', () => {
  it('GET refuses a caller with no credential', async () => {
    const { response } = await get(null);
    expect(response.statusCode).toBe(401);
    expect(json<ErrorResponseBody>(response).error).toBe('unauthenticated');
  });

  it('PATCH refuses a caller with no credential', async () => {
    const { response } = await patch(null, { firstName: 'Alex' });
    expect(response.statusCode).toBe(401);
  });

  it('never trusts a userId the body supplies', async () => {
    const { response, profiles } = await patch(ALICE, {
      firstName: 'Alex',
      userId: BOB,
      user_id: BOB,
    });

    expect(response.statusCode).toBe(200);
    const asAlice = await profiles.find(ALICE);
    expect(asAlice?.firstName).toBe('Alex');
    const asBob = await profiles.find(BOB);
    expect(asBob).toBeNull();
  });

  it("one account can never read another's profile", async () => {
    const shared = harness();
    await patch(ALICE, { firstName: 'Alex' }, shared);

    const response = await shared.server.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: await authHeaders(BOB),
    });

    expect(json<ProfileResponseBody>(response).firstName).toBeNull();
  });
});

describe('a brand-new account has no profile yet', () => {
  it('GET answers with every field null and completed false, not a 404', async () => {
    const { response } = await get(ALICE);
    expect(response.statusCode).toBe(200);
    expect(json<ProfileResponseBody>(response)).toEqual({
      firstName: null,
      username: null,
      dateOfBirth: null,
      completed: false,
    });
  });
});

describe('onboarding resumes rather than restarts', () => {
  it('a step submitted alone leaves the others untouched', async () => {
    const shared = harness();
    await patch(ALICE, { firstName: 'Alex' }, shared);
    const { response } = await patch(ALICE, { username: 'alex_nine' }, shared);

    const body = json<ProfileResponseBody>(response);
    expect(body.firstName).toBe('Alex');
    expect(body.username).toBe('alex_nine');
    expect(body.dateOfBirth).toBeNull();
    expect(body.completed).toBe(false);
  });

  it('GET reflects exactly what has been saved so far, for the next launch to resume from', async () => {
    const shared = harness();
    await patch(ALICE, { firstName: 'Alex' }, shared);

    const response = await shared.server.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: await authHeaders(ALICE),
    });

    expect(json<ProfileResponseBody>(response)).toEqual({
      firstName: 'Alex',
      username: null,
      dateOfBirth: null,
      completed: false,
    });
  });

  it('becomes completed the moment the third field arrives, in one request', async () => {
    const shared = harness();
    await patch(ALICE, { firstName: 'Alex' }, shared);
    await patch(ALICE, { username: 'alex_nine' }, shared);
    const { response } = await patch(ALICE, { dateOfBirth: '2000-01-01' }, shared);

    expect(json<ProfileResponseBody>(response).completed).toBe(true);
  });

  it('all three fields sent together complete onboarding in a single call', async () => {
    const { response } = await patch(ALICE, {
      firstName: 'Alex',
      username: 'alex_nine',
      dateOfBirth: '2000-01-01',
    });

    expect(json<ProfileResponseBody>(response).completed).toBe(true);
  });

  it('completed_at, once set, is never cleared by a later unrelated update', async () => {
    const shared = harness();
    await patch(
      ALICE,
      { firstName: 'Alex', username: 'alex_nine', dateOfBirth: '2000-01-01' },
      shared,
    );

    const { response } = await patch(ALICE, { firstName: 'Alexandra' }, shared);
    const body = json<ProfileResponseBody>(response);
    expect(body.completed).toBe(true);
    expect(body.firstName).toBe('Alexandra');
  });
});

describe('username uniqueness is case-insensitive and enforced at the database level', () => {
  it('a second account may not take a username already in use, even with different casing', async () => {
    const shared = harness();
    await patch(ALICE, { username: 'NexaFan' }, shared);

    const { response } = await patch(BOB, { username: 'nexafan' }, shared);

    expect(response.statusCode).toBe(409);
    expect(json<ErrorResponseBody>(response).error).toBe('username_taken');
  });

  it("stores and returns the account's own chosen casing", async () => {
    const { response } = await patch(ALICE, { username: 'NexaFan' });
    expect(json<ProfileResponseBody>(response).username).toBe('NexaFan');
  });

  it('an account may re-save its own username unchanged without a false conflict', async () => {
    const shared = harness();
    await patch(ALICE, { username: 'alex_nine' }, shared);
    const { response } = await patch(ALICE, { username: 'alex_nine' }, shared);

    expect(response.statusCode).toBe(200);
  });

  it('rejects a username shorter than 3 characters', async () => {
    const { response } = await patch(ALICE, { username: 'al' });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects a username longer than 20 characters', async () => {
    const { response } = await patch(ALICE, { username: 'a'.repeat(21) });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a username that does not start with a letter', async () => {
    const { response } = await patch(ALICE, { username: '9alex' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a username containing a space', async () => {
    const { response } = await patch(ALICE, { username: 'alex nine' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a username containing punctuation outside underscore', async () => {
    const { response } = await patch(ALICE, { username: 'alex-nine' });
    expect(response.statusCode).toBe(400);
  });

  it('accepts underscores and digits after the first letter', async () => {
    const { response } = await patch(ALICE, { username: 'a1_2_3' });
    expect(response.statusCode).toBe(200);
  });
});

describe('date of birth', () => {
  it('rejects a value that is not a date at all', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: 'not-a-date' });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).error).toBe('invalid_request');
  });

  it('rejects a calendar date that does not exist, rather than silently rolling it over', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: '2023-02-30' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a date in the future', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: '2099-01-01' });
    expect(response.statusCode).toBe(400);
    expect(json<ErrorResponseBody>(response).message).not.toContain('13');
  });

  it('rejects an account one day short of turning 13, with a friendly message', async () => {
    // NOW is 2024-06-15, so 2011-06-16 turns 13 the day after "now".
    const { response } = await patch(ALICE, { dateOfBirth: '2011-06-16' });
    expect(response.statusCode).toBe(400);
    const body = json<ErrorResponseBody>(response);
    expect(body.error).toBe('invalid_request');
    expect(body.message).toBe('You need to be at least 13 to use Nexa.');
  });

  it('accepts an account exactly 13 today', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: '2011-06-15' });
    expect(response.statusCode).toBe(200);
    expect(json<ProfileResponseBody>(response).dateOfBirth).toBe('2011-06-15');
  });

  it('accepts an account comfortably older than 13', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: '1990-01-01' });
    expect(response.statusCode).toBe(200);
  });

  it('never stores a calculated age — only the date supplied', async () => {
    const { response } = await patch(ALICE, { dateOfBirth: '1990-01-01' });
    const serialised = JSON.stringify(json(response));
    expect(serialised).not.toMatch(/"age"/);
    expect(serialised).toContain('1990-01-01');
  });
});

describe('first name', () => {
  it('rejects an empty first name', async () => {
    const { response } = await patch(ALICE, { firstName: '' });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a first name that is only whitespace', async () => {
    const { response } = await patch(ALICE, { firstName: '   ' });
    expect(response.statusCode).toBe(400);
  });

  it('trims surrounding whitespace rather than storing it', async () => {
    const { response } = await patch(ALICE, { firstName: '  Alex  ' });
    expect(json<ProfileResponseBody>(response).firstName).toBe('Alex');
  });

  it('rejects a first name longer than 50 characters', async () => {
    const { response } = await patch(ALICE, { firstName: 'a'.repeat(51) });
    expect(response.statusCode).toBe(400);
  });

  it('accepts a first name at exactly 50 characters', async () => {
    const { response } = await patch(ALICE, { firstName: 'a'.repeat(50) });
    expect(response.statusCode).toBe(200);
  });
});

describe('edge cases', () => {
  it('an empty body is rejected rather than silently accepted', async () => {
    const { response } = await patch(ALICE, {});
    expect(response.statusCode).toBe(400);
  });

  it('a non-string field is rejected rather than coerced', async () => {
    const { response } = await patch(ALICE, { firstName: 42 });
    expect(response.statusCode).toBe(400);
  });

  it('the response never carries anything beyond the four documented fields', async () => {
    const { response } = await patch(ALICE, { firstName: 'Alex' });
    expect(Object.keys(json(response)).sort()).toEqual([
      'completed',
      'dateOfBirth',
      'firstName',
      'username',
    ]);
  });

  it('never echoes the account id anywhere in the response', async () => {
    const { response } = await patch(ALICE, { firstName: 'Alex' });
    expect(JSON.stringify(json(response))).not.toContain(ALICE);
  });
});
