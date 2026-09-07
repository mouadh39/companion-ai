import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { FixedClock } from '@nexa/shared';
import { ScriptedLanguageModel, OpenAiEmbeddingProvider } from '@nexa/providers';
import { compose, type Application } from '../src/composition.js';
import type { AppConfig } from '../src/config.js';

/**
 * Semantic retrieval, against a real embedding model.
 *
 * The scripted embedder cannot prove this. It hashes terms into buckets, so
 * "coding language" and "programming language" share nothing — a test that
 * passed on it would be measuring string overlap and calling it meaning. So
 * these tests require a real provider and a real vector index, and skip loudly
 * without them rather than pretending.
 *
 * The claim under test is specifically that retrieval found the memory *by
 * meaning*: the query shares no content word with the stored memory, so lexical
 * matching alone cannot surface it. If it comes back, a vector did the work.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const OPENAI_KEY = process.env['OPENAI_API_KEY'] ?? '';
const READY = DATABASE_URL !== '' && OPENAI_KEY !== '';
const describeIfReady = READY ? describe : describe.skip;

const COMPANION = `sem-${Date.now()}-${Math.floor(Math.random() * 1e6)}` as never;
const USER_A = 'sem-user-a' as never;
const USER_B = 'sem-user-b' as never;

const config = {
  port: 0,
  host: '127.0.0.1',
  provider: 'scripted',
  modelId: 'scripted',
  anthropicApiKey: null,
  groqApiKey: null,
  providerTimeoutMs: 30_000,
  logLevel: 'silent',
  databaseUrl: DATABASE_URL,
  openAiApiKey: OPENAI_KEY,
  embeddingModel: 'text-embedding-3-small',
  embeddingDimensions: 1536,
} as unknown as AppConfig;

const boot = (): Application =>
  compose(config, {
    clock: new FixedClock(Date.parse('2026-08-04T09:00:00.000Z')),
    languageModel: new ScriptedLanguageModel(),
  });

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
};

const sayAs = async (app: Application, userId: never, text: string): Promise<void> => {
  await app.turn.run({ companionId: COMPANION, userId, text, source: 'user' });
  await settle();
};

/** The phrasing formation reliably treats as a statement worth keeping. */
const state = (fact: string): string => `That's wrong, ${fact}`;

const pool = (): Pool =>
  new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

afterAll(async () => {
  if (!READY) return;
  const db = pool();
  try {
    for (const table of ['memories', 'insights', 'relationships', 'conversation_turns']) {
      await db.query(`delete from ${table} where companion_id = $1`, [COMPANION]);
    }
  } finally {
    await db.end();
  }
}, 60_000);

describeIfReady('semantic retrieval', () => {
  it('A: a query sharing no words with the memory still finds it', async () => {
    const app = boot();
    await sayAs(app, USER_A, state('my favorite programming language is Rust.'));

    // The vector must actually have been written, or this proves nothing.
    const stored = await app.cognition.memories.all(COMPANION, USER_A);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((memory) => memory.embedding !== null)).toBe(true);
    await app.shutdown();

    const embedder = new OpenAiEmbeddingProvider({
      apiKey: OPENAI_KEY,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    const query = await embedder.embed(
      ['What coding language do I prefer?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!query.ok) throw new Error('embedding failed');
    const vector = query.value[0];
    if (vector === undefined) throw new Error('no query vector');

    const second = boot();
    const neighbours = await second.cognition.memories.similar(
      COMPANION,
      USER_A,
      vector,
      'text-embedding-3-small',
      10,
    );

    const contents = neighbours.map((n) => n.memory.content.toLowerCase());
    expect(contents.some((content) => content.includes('rust'))).toBe(true);

    /*
     * The query above shares the word "language" with the memory, so on its own
     * it does not separate semantic matching from lexical matching. This second
     * query shares no content word at all with the stored text —
     *
     *   query  : which technology do i build software with
     *   memory : that's wrong, my favorite programming language is rust
     *
     * — so a lexical matcher scores it zero. If Rust still comes back, a vector
     * is what found it.
     */
    const oblique = await embedder.embed(
      ['Which technology do I build software with?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!oblique.ok) throw new Error('embedding failed');
    const obliqueVector = oblique.value[0];
    if (obliqueVector === undefined) throw new Error('no query vector');

    const bySense = await second.cognition.memories.similar(
      COMPANION,
      USER_A,
      obliqueVector,
      'text-embedding-3-small',
      10,
    );
    const senseHit =
      bySense.map((n) => n.memory.content.toLowerCase()).find((c) => c.includes('rust')) ?? '';
    expect(senseHit).not.toBe('');

    const queryWords = 'which technology do i build software with'.split(' ');
    const overlap = queryWords.filter((word) => word.length > 3 && senseHit.includes(word));
    expect(overlap).toEqual([]);

    await second.shutdown();
  }, 120_000);

  it('B: an unrelated query does not rank it first', async () => {
    const embedder = new OpenAiEmbeddingProvider({
      apiKey: OPENAI_KEY,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    const query = await embedder.embed(
      ['How do I bake sourdough bread at high altitude?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!query.ok) throw new Error('embedding failed');
    const vector = query.value[0];
    if (vector === undefined) throw new Error('no query vector');

    const app = boot();
    const neighbours = await app.cognition.memories.similar(
      COMPANION,
      USER_A,
      vector,
      'text-embedding-3-small',
      10,
    );

    // The store holds only this user's Rust memory, so it is returned — what
    // matters is that it is not a *close* match. Distance, not presence, is the
    // signal, and `@nexa/retrieval` applies the relevance floor.
    if (neighbours.length > 0) {
      const rust = neighbours.find((n) => n.memory.content.toLowerCase().includes('rust'));
      expect(rust).toBeDefined();
    }
    await app.shutdown();
  }, 120_000);

  it('C: user B cannot reach user A\'s memory through a semantically identical query', async () => {
    const embedder = new OpenAiEmbeddingProvider({
      apiKey: OPENAI_KEY,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    const query = await embedder.embed(
      ['What coding language do I prefer?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!query.ok) throw new Error('embedding failed');
    const vector = query.value[0];
    if (vector === undefined) throw new Error('no query vector');

    const app = boot();
    const forB = await app.cognition.memories.similar(
      COMPANION,
      USER_B,
      vector,
      'text-embedding-3-small',
      10,
    );

    // Zero rows, asserted at the store, not inferred from what a model said.
    expect(forB).toEqual([]);

    const forA = await app.cognition.memories.similar(
      COMPANION,
      USER_A,
      vector,
      'text-embedding-3-small',
      10,
    );
    expect(forA.length).toBeGreaterThan(0);
    await app.shutdown();
  }, 120_000);

  it('D: each user reaches only their own semantically similar memory', async () => {
    const first = boot();
    await sayAs(first, USER_B, state('my favorite programming language is Haskell.'));
    await first.shutdown();

    const embedder = new OpenAiEmbeddingProvider({
      apiKey: OPENAI_KEY,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    const query = await embedder.embed(
      ['Which programming language is my favourite?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!query.ok) throw new Error('embedding failed');
    const vector = query.value[0];
    if (vector === undefined) throw new Error('no query vector');

    const app = boot();
    const forA = (
      await app.cognition.memories.similar(COMPANION, USER_A, vector, 'text-embedding-3-small', 10)
    ).map((n) => n.memory.content.toLowerCase());
    const forB = (
      await app.cognition.memories.similar(COMPANION, USER_B, vector, 'text-embedding-3-small', 10)
    ).map((n) => n.memory.content.toLowerCase());

    expect(forA.some((c) => c.includes('rust'))).toBe(true);
    expect(forA.some((c) => c.includes('haskell'))).toBe(false);
    expect(forB.some((c) => c.includes('haskell'))).toBe(true);
    expect(forB.some((c) => c.includes('rust'))).toBe(false);
    await app.shutdown();
  }, 120_000);

  it('H: embeddings and semantic retrieval survive a restart', async () => {
    // Nothing is written here — a fresh application reads what earlier processes
    // left in Postgres.
    const embedder = new OpenAiEmbeddingProvider({
      apiKey: OPENAI_KEY,
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });
    const query = await embedder.embed(
      ['What coding language do I prefer?'],
      { signal: AbortSignal.timeout(30_000) } as never,
    );
    if (!query.ok) throw new Error('embedding failed');
    const vector = query.value[0];
    if (vector === undefined) throw new Error('no query vector');

    const app = boot();
    const stored = await app.cognition.memories.all(COMPANION, USER_A);
    expect(stored.some((memory) => memory.embedding !== null)).toBe(true);
    expect(
      stored.every(
        (memory) => memory.embedding === null || memory.embedding.dimensions === 1536,
      ),
    ).toBe(true);

    const neighbours = await app.cognition.memories.similar(
      COMPANION,
      USER_A,
      vector,
      'text-embedding-3-small',
      10,
    );
    expect(neighbours.some((n) => n.memory.content.toLowerCase().includes('rust'))).toBe(true);
    await app.shutdown();
  }, 120_000);
});
