import { Pool } from 'pg';
import { timestamp } from '@nexa/models';
import { systemClock } from '@nexa/shared';
import { OpenAiEmbeddingProvider } from '@nexa/providers';
import type { PortOptions } from '@nexa/core';
import { loadConfig } from '../config.js';
import { PgMemoryStore } from '../adapters/postgres/stores.js';

/**
 * Gives existing memories their vectors.
 *
 * A standalone script rather than boot-time work. A backend that embedded on
 * startup is a backend that will not start when the provider is down, and the
 * whole design of `Memory.embedding` is that a memory is readable long before it
 * is searchable — so this is allowed to take as long as it takes.
 *
 * ## The properties that make it safe to re-run
 *
 * - **Idempotent** — the queue is `embedding is null or embedding_model is
 *   distinct from <model>`. A completed row leaves the queue and never returns,
 *   so running this twice does the second half of the work and nothing else.
 * - **Resumable** — work is claimed in batches ordered by `created_at`. A crash
 *   loses at most the batch in flight, and the next run picks it up because
 *   those rows still match the queue predicate.
 * - **Non-duplicating** — every write is `update … where id = $`. Nothing here
 *   inserts a memory, so it cannot fork one.
 * - **Non-destructive** — it only ever populates `embedding` and the four
 *   metadata columns. No content, no expiry, no ownership is touched.
 * - **Owner-preserving** — the queue is the one query in the system that spans
 *   owners, and it is safe because it never *compares* anything: each row
 *   carries its own `companionId`/`userId`, which go straight back into
 *   `attachEmbedding`, whose update is scoped by both. No row is ever read on
 *   behalf of a different user.
 * - **Rate-limit friendly** — one API call per batch, with a pause between.
 *
 * Usage: `node --env-file=.env dist/scripts/backfill-embeddings.js [batchSize]`
 */

const BATCH_SIZE = Number(process.argv[2] ?? '32');
const PAUSE_MS = 250;

/**
 * Port options for work that is not part of a turn.
 *
 * `PortOptions` is shaped for calls made inside a turn — a deadline carved
 * from the turn's budget, a turn id to correlate logs. A backfill has
 * neither. The cast is confined to this one function so the absence is
 * stated once, here, instead of appearing as `as never` at the call site.
 */
const backfillOptions = (): PortOptions =>
  ({ signal: AbortSignal.timeout(60_000), turnId: 'backfill' } as unknown as PortOptions);

const main = async (): Promise<void> => {
  const config = loadConfig();

  if (config.databaseUrl === null) {
    console.error('[backfill] DATABASE_URL is not set; there is nothing durable to backfill.');
    process.exit(1);
  }
  if (config.openAiApiKey === null) {
    console.error('[backfill] OPENAI_API_KEY is not set; cannot produce vectors.');
    process.exit(1);
  }

  const embedder = new OpenAiEmbeddingProvider({
    apiKey: config.openAiApiKey,
    model: config.embeddingModel,
    dimensions: config.embeddingDimensions,
  });

  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  const store = new PgMemoryStore(pool);

  let embedded = 0;
  let failed = 0;

  try {
    console.log(`[backfill] model=${embedder.model} dimensions=${String(embedder.dimensions)}`);

    for (;;) {
      const pending = await store.awaitingEmbedding(embedder.model, BATCH_SIZE);
      if (pending.length === 0) break;

      const result = await embedder.embed(
        pending.map((memory) => memory.content),
        // Not a turn, so there is no turn budget to inherit. The provider reads
        // `signal` and nothing else; the rest of `PortOptions` exists for calls
        // made inside a turn, which this is not.
        backfillOptions(),
      );

      if (!result.ok) {
        // Stop rather than spin. A failing provider will fail the next batch too,
        // and the queue predicate means nothing is lost by trying again later.
        console.error(`[backfill] provider error: ${result.error.message}`);
        failed += pending.length;
        break;
      }

      for (let i = 0; i < pending.length; i++) {
        const memory = pending[i];
        const vector = result.value[i];
        if (memory === undefined || vector === undefined) continue;

        await store.attachEmbedding(memory.companionId, memory.userId, memory.id, vector, {
          model: embedder.model,
          dimensions: embedder.dimensions,
          vectorId: `${memory.id}:${String(Date.now())}`,
          embeddedAt: timestamp(systemClock.nowIso()),
        });
        embedded++;
      }

      console.log(`[backfill] embedded ${String(embedded)} so far…`);
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }

    console.log(`[backfill] done. embedded=${String(embedded)} failed=${String(failed)}`);
  } finally {
    await pool.end();
  }

  if (failed > 0) process.exit(1);
};

main().catch((error: unknown) => {
  console.error('[backfill] failed', error);
  process.exit(1);
});
