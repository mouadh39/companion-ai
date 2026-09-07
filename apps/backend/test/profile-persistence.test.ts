import { afterAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import type { UserId } from '@nexa/shared';
import { PgProfileStore } from '../src/profile/store.js';

/**
 * `PgProfileStore` against a real Postgres.
 *
 * The in-memory store is covered by `profile.test.ts`; this is the half the
 * unit suite cannot see — the SQL, the `coalesce` merge, `completed_at`
 * computed in-statement, the case-insensitive unique index, and the one
 * thing that actually bit in an end-to-end run: a `date` column read back as
 * a `Date` at the process's *local* midnight, which shifts the calendar day
 * on any non-UTC host. Every query now reads `date_of_birth::text`; this
 * asserts the date that comes back is the date that went in, exactly.
 *
 * Skips itself with no `DATABASE_URL`, same as `persistence.test.ts`. Scopes
 * every row to a unique `user_id` prefix and deletes them afterwards.
 */

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const describeIfDb = DATABASE_URL === '' ? describe.skip : describe;

const RUN = `pt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const userId = (suffix: string) => `${RUN}-${suffix}` as UserId;

const pool = new Pool({
  connectionString: DATABASE_URL || 'postgres://unused',
  ssl: { rejectUnauthorized: false },
});
const store = new PgProfileStore(pool);

afterAll(async () => {
  if (DATABASE_URL !== '') {
    await pool.query(`delete from profiles where user_id like $1`, [`${RUN}-%`]);
  }
  await pool.end();
});

describeIfDb('PgProfileStore', () => {
  it('a new account has no row, and find returns null', async () => {
    expect(await store.find(userId('absent'))).toBeNull();
  });

  it('upsert creates the row on first use and merges each later step', async () => {
    const id = userId('resume');

    const a = await store.upsert(id, { firstName: 'Mo' });
    expect(a).toEqual({
      ok: true,
      profile: {
        userId: id,
        firstName: 'Mo',
        username: null,
        dateOfBirth: null,
        completedAt: null,
      },
    });

    const b = await store.upsert(id, { username: 'mo_persist' });
    expect(b.ok && b.profile.firstName).toBe('Mo');
    expect(b.ok && b.profile.username).toBe('mo_persist');
    expect(b.ok && b.profile.completedAt).toBeNull();

    // Resume: a step re-sent alone must not blank the others.
    const c = await store.upsert(id, { firstName: 'Mouadh' });
    expect(c.ok && c.profile.username).toBe('mo_persist');
  });

  it('the date of birth round-trips as the exact calendar date, not a timezone-shifted one', async () => {
    const id = userId('dob');
    const written = '1998-05-04';

    const patched = await store.upsert(id, { dateOfBirth: written });
    expect(patched.ok && patched.profile.dateOfBirth).toBe(written);

    const read = await store.find(id);
    expect(read?.dateOfBirth).toBe(written);

    // And what Postgres itself holds is the same calendar date.
    const raw = await pool.query<{ dob: string }>(
      `select date_of_birth::text as dob from profiles where user_id = $1`,
      [id],
    );
    expect(raw.rows[0]?.dob).toBe(written);
  });

  it('completed_at is set the moment all three fields are present, and never cleared after', async () => {
    const id = userId('complete');
    await store.upsert(id, { firstName: 'Ada' });
    await store.upsert(id, { username: 'ada_persist' });

    const done = await store.upsert(id, { dateOfBirth: '2000-01-01' });
    expect(done.ok && done.profile.completedAt).toBeInstanceOf(Date);
    const firstCompletedAt = done.ok ? done.profile.completedAt : null;

    // A later unrelated edit keeps the original completion instant.
    const later = await store.upsert(id, { firstName: 'Adaline' });
    expect(later.ok && later.profile.completedAt?.getTime()).toBe(firstCompletedAt?.getTime());
  });

  it('rejects a username another account already holds, case-insensitively', async () => {
    const owner = userId('owner');
    const rival = userId('rival');

    const taken = await store.upsert(owner, { username: 'CaseFold_QA' });
    expect(taken.ok).toBe(true);

    const collision = await store.upsert(rival, { username: 'casefold_qa' });
    expect(collision).toEqual({ ok: false, reason: 'username_taken' });

    // The rival can still take a free one.
    const free = await store.upsert(rival, { username: 'rival_persist' });
    expect(free.ok).toBe(true);
  });

  it('an account may re-save its own username without a false conflict', async () => {
    const id = userId('self');
    await store.upsert(id, { username: 'self_persist' });
    const again = await store.upsert(id, { username: 'self_persist' });
    expect(again.ok).toBe(true);
  });
});
