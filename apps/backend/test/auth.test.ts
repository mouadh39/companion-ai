import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { FixedClock, trustExternalId, type CompanionId, type UserId } from '@nexa/shared';
import { currentIdentity } from '@nexa/identity';
import { Deadline, type PortOptions } from '@nexa/core';
import { timestamp } from '@nexa/models';
import { ScriptedLanguageModel } from '@nexa/providers';
import { compose } from '../dist/composition.js';
import { authenticate, admitForCompanion, buildServer } from '../dist/server.js';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../dist/config.js';
import { SupabaseAuthenticator } from '../dist/auth/supabase.js';
import { DenyAllAuthenticator } from '../dist/auth/deny-all.js';
import { InMemoryCompanionBindings } from '../dist/auth/bindings.js';

/**
 * The authentication boundary.
 *
 * These exercise the **real** Supabase verifier, not a stand-in. Its tokens are
 * ordinary signed JWTs, so a test can mint one locally with the same secret and
 * the verification path that runs here is the one that runs in production —
 * signature, expiry, audience and all. Nothing reaches the network.
 *
 * What is being proved is narrow and important: before this, `userId` came from
 * the request body, so any caller could read and rewrite any other person's
 * memories by typing their id.
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

const clock = new FixedClock(new Date('2026-08-30T12:00:00.000Z'));
const AT = timestamp('2026-08-30T12:00:00.000Z');

const portOptions = (): PortOptions => ({
  signal: new AbortController().signal,
  deadline: Deadline.after(clock, 5_000),
  turnId: trustExternalId('turn-1'),
});

const COMPANION = trustExternalId<CompanionId>('companion-1');
const ALICE = trustExternalId<UserId>('alice-uuid');
const BOB = trustExternalId<UserId>('bob-uuid');

/** Mints a token the real verifier will accept, exactly as Supabase would. */
const tokenFor = async (
  subject: string,
  over: { readonly audience?: string; readonly expiresIn?: string; readonly secret?: string } = {},
): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setAudience(over.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(over.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(over.secret ?? JWT_SECRET));

/** Both users bound to the companion unless a test says otherwise. */
const harness = (bind: readonly UserId[] = [ALICE, BOB]) => {
  const bindings = new InMemoryCompanionBindings();
  for (const user of bind) bindings.bind(user, COMPANION);

  const app = compose(config, {
    languageModel: new ScriptedLanguageModel(['Sure.', 'Sure.', 'Sure.', 'Sure.']),
    bindings,
  });

  return { app, server: buildServer(app, config), bindings };
};

const turn = (text: string, token: string | null, companionId: string = COMPANION) => ({
  method: 'POST' as const,
  url: '/v1/turn',
  ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
  payload: { companionId, text },
});

describe('a request must prove who it is', () => {
  it('rejects a request with no credential', async () => {
    const { app, server } = harness();
    const response = await server.inject(turn('Hello.', null));

    expect(response.statusCode).toBe(401);
    await app.shutdown();
  });

  it('rejects a malformed authorization header', async () => {
    const { app, server } = harness();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: { authorization: 'Basic aGk6dGhlcmU=' },
      payload: { companionId: COMPANION, text: 'Hello.' },
    });

    expect(response.statusCode).toBe(401);
    await app.shutdown();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const { app, server } = harness();
    const forged = await tokenFor(ALICE, { secret: 'a-different-secret-entirely-000000' });

    expect((await server.inject(turn('Hello.', forged))).statusCode).toBe(401);
    await app.shutdown();
  });

  it('rejects an expired token', async () => {
    const { app, server } = harness();
    const stale = await tokenFor(ALICE, { expiresIn: '-1h' });

    expect((await server.inject(turn('Hello.', stale))).statusCode).toBe(401);
    await app.shutdown();
  });

  it('rejects a token issued for a different audience', async () => {
    const { app, server } = harness();
    const wrong = await tokenFor(ALICE, { audience: 'service_role' });

    expect((await server.inject(turn('Hello.', wrong))).statusCode).toBe(401);
    await app.shutdown();
  });

  it('accepts a valid token and resolves the right user', async () => {
    const { app, server } = harness();

    const response = await server.inject(
      turn('Remember that my favourite colour is green.', await tokenFor(ALICE)),
    );

    expect(response.statusCode).toBe(200);

    // Working memory is appended synchronously during commit, so it is the
    // reliable evidence of which account the turn was scoped to. Long-term
    // memory is formed asynchronously and would race this assertion.
    const mine = await app.cognition.workingMemory.recent(COMPANION, ALICE, 10, portOptions());
    const others = await app.cognition.workingMemory.recent(COMPANION, BOB, 10, portOptions());

    expect(mine.length).toBeGreaterThan(0);
    expect(others).toHaveLength(0);

    await app.shutdown();
  });
});

describe('a body cannot claim to be somebody else', () => {
  it('ignores a userId in the payload and uses the verified one', async () => {
    const { app, server } = harness();

    // Alice's token, Bob's id in the body. The body must count for nothing.
    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: { authorization: `Bearer ${await tokenFor(ALICE)}` },
      payload: {
        companionId: COMPANION,
        userId: BOB,
        text: 'Remember that my secret is ALICE-ONLY.',
      },
    });

    const bobs = await app.cognition.workingMemory.recent(COMPANION, BOB, 10, portOptions());
    const alices = await app.cognition.workingMemory.recent(COMPANION, ALICE, 10, portOptions());

    // The words went to Alice, whose token it was, and Bob's history is empty.
    expect(JSON.stringify(bobs)).not.toContain('ALICE-ONLY');
    expect(bobs).toHaveLength(0);
    expect(JSON.stringify(alices)).toContain('ALICE-ONLY');

    await app.shutdown();
  });

  it('keeps one user out of another user memories', async () => {
    const { app, server } = harness();

    await server.inject(
      turn('Remember that my passphrase is HELIOTROPE.', await tokenFor(ALICE)),
    );
    await server.inject(turn('What is my passphrase?', await tokenFor(BOB)));

    const bobs = await app.cognition.workingMemory.recent(COMPANION, BOB, 20, portOptions());
    const alices = await app.cognition.workingMemory.recent(COMPANION, ALICE, 20, portOptions());

    expect(JSON.stringify(alices)).toContain('HELIOTROPE');
    expect(JSON.stringify(bobs)).not.toContain('HELIOTROPE');

    await app.shutdown();
  });

  it('keeps relationships separate', async () => {
    const { app, server } = harness();

    await server.inject(turn('Hello there.', await tokenFor(ALICE)));
    await server.inject(turn('Hello there.', await tokenFor(ALICE)));

    // `current` creates on first contact, so both return a record. What must
    // differ is the history: Alice has spoken, Bob has not, and Alice's turns
    // must not have advanced Bob's relationship.
    const alices = await app.cognition.relationships.current(COMPANION, ALICE, AT);
    const bobs = await app.cognition.relationships.current(COMPANION, BOB, AT);

    expect(alices.interactionCount).toBeGreaterThan(0);
    expect(bobs.interactionCount).toBe(0);

    await app.shutdown();
  });
});

describe('a companion belongs to an account', () => {
  it('refuses a companion the caller is not bound to', async () => {
    // Only Alice is bound; Bob is authenticated but not permitted.
    const { app, server } = harness([ALICE]);

    const response = await server.inject(turn('Hello.', await tokenFor(BOB)));

    expect(response.statusCode).toBe(403);
    await app.shutdown();
  });

  it('refuses action outcomes for a companion the caller is not bound to', async () => {
    // The hole a verified userId alone would leave: body state is keyed on the
    // companion, so without this a proved user could drive somebody else's body.
    const { app, server } = harness([ALICE]);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: { authorization: `Bearer ${await tokenFor(BOB)}` },
      payload: {
        companionId: COMPANION,
        outcomes: [{ actionId: 'a1', actionType: 'move', status: 'completed' }],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(app.cognition.embodiment.snapshot(COMPANION)).toBeNull();

    await app.shutdown();
  });

  it('accepts action outcomes from the bound account', async () => {
    const { app, server } = harness([ALICE]);

    const response = await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: { authorization: `Bearer ${await tokenFor(ALICE)}` },
      payload: {
        companionId: COMPANION,
        outcomes: [{ actionId: 'a1', actionType: 'move', status: 'completed' }],
      },
    });

    expect(response.statusCode).toBe(202);
    await app.shutdown();
  });
});

describe('one account, several devices', () => {
  it('accepts the same account from two independently issued tokens', async () => {
    // Two devices sign in separately and get different tokens for one account.
    // Both are the same person, and both reach the same memory.
    const { app, server } = harness();

    // Separately issued credentials, one account. They may be byte-identical
    // when the claims match — what matters is that each is verified on its own
    // and both resolve to the same person.
    const phone = await tokenFor(ALICE);
    const headset = await tokenFor(ALICE, { expiresIn: '2h' });

    expect((await server.inject(turn('Remember: I like rain.', phone))).statusCode).toBe(200);
    expect((await server.inject(turn('What do I like?', headset))).statusCode).toBe(200);

    // One shared history, reached from both devices.
    const history = await app.cognition.workingMemory.recent(COMPANION, ALICE, 20, portOptions());
    expect(JSON.stringify(history)).toContain('rain');
    expect(JSON.stringify(history)).toContain('What do I like?');

    await app.shutdown();
  });

  it('lets two devices declare different hardware without changing the account', async () => {
    // Account identity and device capability are separate axes: the same user
    // may be on a headset with a microphone and a desk client without one.
    const { app, server } = harness();
    const token = await tokenFor(ALICE);

    await server.inject({
      method: 'POST',
      url: '/v1/action-result',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        companionId: COMPANION,
        outcomes: [],
        activity: 'idle',
        canPerform: ['move'],
        devices: [
          { id: 'm', kind: 'microphone', label: 'Mic', status: 'connected', provides: ['speech_in'] },
        ],
      },
    });

    expect(app.cognition.embodiment.devicesOf(COMPANION)).toHaveLength(1);
    await app.shutdown();
  });
});

describe('Nexa is the same whoever is asking', () => {
  it('resolves an identical identity for two different accounts', async () => {
    const { app } = harness();

    const forAlice = await app.cognition.selfModel.resolve(
      { companionId: COMPANION, identity: currentIdentity(), body: null, clientCapabilities: null },
      portOptions(),
    );
    const forBob = await app.cognition.selfModel.resolve(
      { companionId: COMPANION, identity: currentIdentity(), body: null, clientCapabilities: null },
      portOptions(),
    );

    expect(forAlice.identity).toBe(forBob.identity);
    expect(forAlice.identity.name).toBe('Nexa');

    await app.shutdown();
  });

  it('puts no account information into the self state', async () => {
    const { app } = harness();

    const self = await app.cognition.selfModel.resolve(
      { companionId: COMPANION, identity: currentIdentity(), body: null, clientCapabilities: null },
      portOptions(),
    );

    const rendered = JSON.stringify(self);
    expect(rendered).not.toContain(ALICE);
    expect(rendered).not.toContain(BOB);

    await app.shutdown();
  });
});

describe('a misconfigured server refuses rather than trusts', () => {
  it('denies every request when no secret is configured', async () => {
    // The one direction this may fail in. Falling back to the identifiers in
    // the body is the hole this whole step closes, and it must not reappear
    // because someone forgot an environment variable.
    const app = compose(
      { ...config, supabaseJwtSecret: null },
      { languageModel: new ScriptedLanguageModel(['Sure.']) },
    );
    const server = buildServer(app, config);

    expect(app.auth.name).toBe('deny-all');

    const response = await server.inject({
      method: 'POST',
      url: '/v1/turn',
      payload: { companionId: COMPANION, userId: ALICE, text: 'Hello.' },
    });

    // 503, not 401: this is a broken server rather than a bad caller.
    expect(response.statusCode).toBe(503);

    await app.shutdown();
  });

  it('never falls back to the body when verification fails', async () => {
    const { app, server } = harness();

    await server.inject({
      method: 'POST',
      url: '/v1/turn',
      headers: { authorization: 'Bearer not-a-real-token' },
      payload: { companionId: COMPANION, userId: ALICE, text: 'Remember: FALLBACK-LEAK.' },
    });

    const memories = await app.cognition.memories.all(COMPANION, ALICE);
    expect(JSON.stringify(memories)).not.toContain('FALLBACK-LEAK');

    await app.shutdown();
  });
});

describe('the verifier itself', () => {
  it('refuses a token with no subject', async () => {
    const auth = new SupabaseAuthenticator({ jwtSecret: JWT_SECRET });
    const noSubject = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));

    const result = await auth.verify(noSubject);
    expect(result.ok).toBe(false);
  });

  it('refuses a null credential as missing', async () => {
    const auth = new SupabaseAuthenticator({ jwtSecret: JWT_SECRET });
    const result = await auth.verify(null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('missing');
  });

  it('reports a misconfigured server as unavailable, not as a bad caller', async () => {
    const result = await new DenyAllAuthenticator('no secret').verify();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('unavailable');
  });
});

/**
 * The reusable half of the boundary.
 *
 * `authenticate` exists so that an operation concerning the *account* rather
 * than a character — registering a device, listing them — can prove who is
 * calling without being made to invent a `companionId` to get past the door.
 *
 * These call it directly rather than through a route, because no route uses it
 * on its own yet. What is being proved is that the identity it hands back comes
 * from the verified token and from nowhere else, and that splitting it out has
 * not moved any behaviour the companion path depends on.
 */

/** The little of a Fastify request that admission actually touches. */
const requestWith = (authorization?: string): FastifyRequest =>
  ({
    headers: authorization === undefined ? {} : { authorization },
    log: { warn: () => {} },
  }) as unknown as FastifyRequest;

describe('authenticate proves identity without a companion', () => {
  it('returns the trusted userId from a valid token', async () => {
    const { app } = harness();
    const result = await authenticate(app, requestWith(`Bearer ${await tokenFor(ALICE)}`));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.userId).toBe(ALICE);
      expect(result.identity.issuer).toBe('supabase');
    }
  });

  it('never asks for a companionId', async () => {
    const { app } = harness();
    // No companion is named anywhere in this call, and none is bound to CAROL.
    const carol = trustExternalId<UserId>('carol-uuid');
    const result = await authenticate(app, requestWith(`Bearer ${await tokenFor(carol)}`));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.userId).toBe(carol);
  });

  it('refuses a request with no credential', async () => {
    const { app } = harness();
    const result = await authenticate(app, requestWith());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    const { app } = harness();
    const forged = await tokenFor(ALICE, { secret: 'a-different-secret-0123456789abcdef' });
    const result = await authenticate(app, requestWith(`Bearer ${forged}`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('refuses a token carrying no subject', async () => {
    const { app } = harness();
    const noSubject = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(JWT_SECRET));

    const result = await authenticate(app, requestWith(`Bearer ${noSubject}`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('reports a misconfigured server as unavailable rather than as a bad caller', async () => {
    const app = compose(
      { ...config, supabaseJwtSecret: null },
      { languageModel: new ScriptedLanguageModel(['Sure.']) },
    );

    const result = await authenticate(app, requestWith(`Bearer ${await tokenFor(ALICE)}`));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toBe('authentication_unavailable');
    }
  });
});

describe('admitForCompanion still guards the companion', () => {
  it('admits a bound account and reports the verified user', async () => {
    const { app } = harness();
    const result = await admitForCompanion(
      app,
      requestWith(`Bearer ${await tokenFor(ALICE)}`),
      COMPANION,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caller.userId).toBe(ALICE);
      expect(result.caller.companionId).toBe(COMPANION);
    }
  });

  it('requires a companionId even from a perfectly valid token', async () => {
    const { app } = harness();
    const result = await admitForCompanion(
      app,
      requestWith(`Bearer ${await tokenFor(ALICE)}`),
      undefined,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe('invalid_request');
    }
  });

  it('rejects a blank companionId rather than treating it as absent-but-fine', async () => {
    const { app } = harness();
    const result = await admitForCompanion(
      app,
      requestWith(`Bearer ${await tokenFor(ALICE)}`),
      '   ',
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('checks the credential before the companionId, so an anonymous caller learns nothing', async () => {
    const { app } = harness();
    const result = await admitForCompanion(app, requestWith(), undefined);

    // 401, not 400: the shape of a request is none of an unauthenticated
    // caller's business.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('refuses a companion the caller is not bound to', async () => {
    const { app } = harness([ALICE]);
    const result = await admitForCompanion(
      app,
      requestWith(`Bearer ${await tokenFor(BOB)}`),
      COMPANION,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe('forbidden');
    }
  });
});
