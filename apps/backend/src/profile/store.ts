import type { Pool } from 'pg';
import type { UserId } from '@nexa/shared';

/**
 * What onboarding collects, once, about an account.
 *
 * Authentication answers who is calling; this answers what Nexa has learned
 * about them since — a deliberately separate concern, and a deliberately
 * small one. A port with adapters, exactly as `DeviceStore`/
 * `CompanionBindingStore` are: the offline suites run with no database, and
 * this must run with them.
 */

/**
 * An account's profile, or the shape of one that has never been started —
 * every field simply null, which is exactly what "no row yet" and "a row
 * with nothing filled in" both mean to a caller. Nothing here is ever
 * fabricated: a field is null until the account has actually supplied it.
 */
export interface Profile {
  readonly userId: UserId;
  readonly firstName: string | null;
  readonly username: string | null;
  /**
   * `YYYY-MM-DD`, never a `Date` with a time component — this is a date of
   * birth, not an instant, and the migration's own `date` column type
   * matches that. Never logged, never echoed anywhere but this account's own
   * authenticated read.
   */
  readonly dateOfBirth: string | null;
  /**
   * Set the moment `firstName`, `username` and `dateOfBirth` are all
   * non-null for the first time, and never cleared afterwards — the one
   * source of truth for "has this account finished onboarding". See
   * `upsert`.
   */
  readonly completedAt: Date | null;
}

/**
 * What one `PATCH /v1/profile` may change. Every field optional: a caller
 * updates whichever step it just collected, and [ProfileStore.upsert] leaves
 * everything else exactly as it was.
 *
 * Every value here has already been validated by the route handler —
 * shape, uniqueness intent, age — before this type is ever constructed.
 * This interface does not re-validate; it only ever merges.
 */
export interface ProfileUpdate {
  readonly firstName?: string;
  readonly username?: string;
  readonly dateOfBirth?: string;
}

export type ProfileUpdateResult =
  | { readonly ok: true; readonly profile: Profile }
  | {
      readonly ok: false;
      /** Case-insensitive collision with another account's username. */
      readonly reason: 'username_taken';
    };

export interface ProfileStore {
  /** This account's profile, or `null` if onboarding has never been started. */
  find(userId: UserId): Promise<Profile | null>;

  /**
   * Merges whichever fields [update] provides into this account's profile,
   * creating the row on first use. A field [update] does not mention is left
   * exactly as it already was — this is how onboarding resumes: each step
   * sends only what it just collected.
   */
  upsert(userId: UserId, update: ProfileUpdate): Promise<ProfileUpdateResult>;
}

const isComplete = (profile: {
  readonly firstName: string | null;
  readonly username: string | null;
  readonly dateOfBirth: string | null;
}): boolean =>
  profile.firstName !== null && profile.username !== null && profile.dateOfBirth !== null;

/**
 * Profiles held in memory.
 *
 * What a deployment without a database gets, and what the offline suites
 * use. Uniqueness is checked the same way the real index enforces it —
 * case-insensitively, and never against the caller's own existing row.
 */
export class InMemoryProfileStore implements ProfileStore {
  readonly #rows = new Map<string, Profile>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async find(userId: UserId): Promise<Profile | null> {
    return this.#rows.get(userId) ?? null;
  }

  async upsert(userId: UserId, update: ProfileUpdate): Promise<ProfileUpdateResult> {
    const existing = this.#rows.get(userId) ?? {
      userId,
      firstName: null,
      username: null,
      dateOfBirth: null,
      completedAt: null,
    };

    if (update.username !== undefined) {
      const lower = update.username.toLowerCase();
      for (const [otherId, row] of this.#rows) {
        if (otherId === userId) continue;
        if (row.username !== null && row.username.toLowerCase() === lower) {
          return { ok: false, reason: 'username_taken' };
        }
      }
    }

    const merged = {
      firstName: update.firstName ?? existing.firstName,
      username: update.username ?? existing.username,
      dateOfBirth: update.dateOfBirth ?? existing.dateOfBirth,
    };

    const profile: Profile = {
      userId,
      ...merged,
      completedAt: existing.completedAt ?? (isComplete(merged) ? this.#now() : null),
    };

    this.#rows.set(userId, profile);
    return { ok: true, profile };
  }
}

interface ProfileRow {
  readonly user_id: string;
  readonly first_name: string | null;
  readonly username: string | null;
  /**
   * Always the `YYYY-MM-DD` string, never a `Date` — every query below reads
   * this column as `date_of_birth::text`. `pg`'s default `date` parser hands
   * back a `Date` at the *process's local* midnight, and `.toISOString()` on
   * that shifts the calendar day whenever the process is not on UTC (a
   * headset owner born on the 4th would read their birthday back as the 3rd
   * on a UTC+2 host). The cast keeps Postgres's own text form, which is the
   * calendar date and nothing else.
   */
  readonly date_of_birth: string | null;
  readonly completed_at: Date | null;
}

const dateOnly = (value: string | null): string | null =>
  value === null ? null : value.slice(0, 10);

const toProfile = (row: ProfileRow): Profile => ({
  userId: row.user_id as UserId,
  firstName: row.first_name,
  username: row.username,
  dateOfBirth: dateOnly(row.date_of_birth),
  completedAt: row.completed_at,
});

/**
 * Profiles in Postgres.
 *
 * One statement does the whole merge — insert on first use, otherwise
 * `coalesce` each column against what was already there — so two concurrent
 * partial updates (unlikely for one account onboarding itself, but a
 * database does not get to assume that) resolve to one consistent row
 * rather than a read-modify-write race. `completed_at` is computed in the
 * same statement, from the same merged values, for the same reason.
 */
export class PgProfileStore implements ProfileStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async find(userId: UserId): Promise<Profile | null> {
    const result = await this.#pool.query<ProfileRow>(
      `select user_id, first_name, username, date_of_birth::text as date_of_birth, completed_at
         from profiles
        where user_id = $1`,
      [userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : toProfile(row);
  }

  async upsert(userId: UserId, update: ProfileUpdate): Promise<ProfileUpdateResult> {
    const firstName = update.firstName ?? null;
    const username = update.username ?? null;
    const dateOfBirth = update.dateOfBirth ?? null;

    try {
      const result = await this.#pool.query<ProfileRow>(
        `insert into profiles (user_id, first_name, username, date_of_birth, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (user_id) do update set
           first_name    = coalesce($2, profiles.first_name),
           username      = coalesce($3, profiles.username),
           date_of_birth = coalesce($4, profiles.date_of_birth),
           updated_at    = now(),
           completed_at  = case
             when profiles.completed_at is not null then profiles.completed_at
             when coalesce($2, profiles.first_name) is not null
              and coalesce($3, profiles.username) is not null
              and coalesce($4, profiles.date_of_birth) is not null
             then now()
             else null
           end
         returning user_id, first_name, username, date_of_birth::text as date_of_birth, completed_at`,
        [userId, firstName, username, dateOfBirth],
      );

      const row = result.rows[0];
      if (row === undefined) {
        // An upsert with a conflict target cannot return zero rows; if it
        // ever does, something is wrong enough that inventing a profile
        // would be worse than failing loudly.
        throw new Error('profile upsert returned no row');
      }
      return { ok: true, profile: toProfile(row) };
    } catch (error) {
      // Another account already holds this username under some
      // capitalisation — `profiles_username_ci_idx`, not the primary key
      // this statement's own conflict target already handles.
      if (
        (error as { readonly code?: string }).code === '23505' &&
        (error as { readonly constraint?: string }).constraint === 'profiles_username_ci_idx'
      ) {
        return { ok: false, reason: 'username_taken' };
      }
      throw error;
    }
  }
}
