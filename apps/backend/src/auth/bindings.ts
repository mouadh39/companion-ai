import type { Pool } from 'pg';
import type { CompanionId, UserId } from '@nexa/shared';

/**
 * Which companions an account is allowed to speak to.
 *
 * The second half of the authentication boundary, and the reason a verified
 * `userId` alone is not enough. Memory is safe once the user is proved, because
 * every query filters on `user_id` as well — but body state is keyed on the
 * companion alone, since one companion has one body. Without this check a
 * proved user could still post action outcomes to somebody else's character.
 *
 * `CompanionBinding` was already in the domain model, documented for exactly
 * this: *"the same person may eventually have a companion on their glasses and
 * another at their desk with different histories."* This is that join made real.
 */
export interface CompanionBindingStore {
  /**
   * Whether this account may act as this companion.
   *
   * Deliberately a question rather than a lookup returning the binding. Callers
   * need a yes or no, and a method that handed back a row would invite one to
   * be read for a field it should not be trusted for.
   */
  isBound(userId: UserId, companionId: CompanionId): Promise<boolean>;
  /** Every companion this account may act as. For a future device/companion picker. */
  companionsFor(userId: UserId): Promise<readonly CompanionId[]>;
}

/**
 * Bindings held in memory.
 *
 * What a deployment without a database gets, and what the offline suites use.
 * Populated explicitly rather than defaulting to permissive: a store that
 * allowed everything when empty would make the fail-open case the easy one, and
 * the whole point of this type is to fail closed.
 */
export class InMemoryCompanionBindings implements CompanionBindingStore {
  readonly #bound = new Map<string, Set<string>>();

  bind(userId: UserId, companionId: CompanionId): void {
    const existing = this.#bound.get(userId) ?? new Set<string>();
    existing.add(companionId);
    this.#bound.set(userId, existing);
  }

  unbind(userId: UserId, companionId: CompanionId): void {
    this.#bound.get(userId)?.delete(companionId);
  }

  async isBound(userId: UserId, companionId: CompanionId): Promise<boolean> {
    return this.#bound.get(userId)?.has(companionId) ?? false;
  }

  async companionsFor(userId: UserId): Promise<readonly CompanionId[]> {
    return [...(this.#bound.get(userId) ?? [])] as CompanionId[];
  }
}

/**
 * Bindings in Postgres.
 *
 * Reads only `active` rows. A paused companion is not a companion the user may
 * act as, and treating "bound once" as "bound now" would make deactivation
 * decorative.
 */
export class PgCompanionBindings implements CompanionBindingStore {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async isBound(userId: UserId, companionId: CompanionId): Promise<boolean> {
    const result = await this.#pool.query<{ readonly bound: boolean }>(
      `select exists (
         select 1 from companion_bindings
         where user_id = $1 and companion_id = $2 and active
       ) as bound`,
      [userId, companionId],
    );

    return result.rows[0]?.bound ?? false;
  }

  async companionsFor(userId: UserId): Promise<readonly CompanionId[]> {
    const result = await this.#pool.query<{ readonly companion_id: string }>(
      `select companion_id from companion_bindings
       where user_id = $1 and active
       order by bound_at`,
      [userId],
    );

    return result.rows.map((row) => row.companion_id as CompanionId);
  }
}

/**
 * Binds on first sight.
 *
 * A deliberate, named development convenience: the first account to name a
 * companion claims it, and everyone else is refused. It exists because there is
 * no onboarding yet to create a binding, and without it a correctly
 * authenticated user cannot reach any companion at all.
 *
 * **It is not the production policy.** Claim-on-first-use means the binding is
 * created by whoever asks first rather than by a deliberate act, which is fine
 * for a single-developer environment and wrong the moment there are two people.
 * Onboarding replaces this with an explicit bind, and this class should be
 * deleted rather than configured off.
 */
export class ClaimOnFirstUseBindings implements CompanionBindingStore {
  readonly #inner: InMemoryCompanionBindings;
  readonly #owners = new Map<string, string>();

  constructor(inner: InMemoryCompanionBindings = new InMemoryCompanionBindings()) {
    this.#inner = inner;
  }

  async isBound(userId: UserId, companionId: CompanionId): Promise<boolean> {
    const owner = this.#owners.get(companionId);

    if (owner === undefined) {
      this.#owners.set(companionId, userId);
      this.#inner.bind(userId, companionId);
      return true;
    }

    return this.#inner.isBound(userId, companionId);
  }

  async companionsFor(userId: UserId): Promise<readonly CompanionId[]> {
    return this.#inner.companionsFor(userId);
  }
}
