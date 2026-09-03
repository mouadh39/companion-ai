import type { Pool } from 'pg';
import { newDeviceId, type DeviceId, type UserId } from '@nexa/shared';
import type { KeySecurityLevel } from './enrolments.js';

/**
 * The devices on an account.
 *
 * Declared beside the authentication boundary rather than in `@nexa/core` for
 * the same reason `AuthenticationPort` is: which hardware an account owns is a
 * transport and identity concern, settled before a turn exists. The cognitive
 * pipeline has no business knowing a phone was registered.
 *
 * A port with adapters, because the offline suites must run with no database —
 * exactly as `CompanionBindingStore` does.
 */

/** What a device kind may be. Mirrors the `devices_kind_check` constraint. */
export type DeviceKind = 'phone' | 'headset';

/**
 * A device as the account sees it.
 *
 * Deliberately carries no key material. A phone has none, and a headset's
 * public key is not something any account-facing read needs — it exists to be
 * verified against, not to be handed back.
 */
export interface DeviceRecord {
  readonly id: DeviceId;
  readonly userId: UserId;
  readonly kind: DeviceKind;
  readonly label: string | null;
  readonly registeredAt: Date;
  readonly revokedAt: Date | null;
}

export interface RegisterPhone {
  /**
   * The account this device belongs to.
   *
   * Always the subject of a verified token. There is no code path that takes
   * this from a request body, and no field in the request that could carry it.
   */
  readonly userId: UserId;
  /** What a person calls it. Display only, and never trusted for anything. */
  readonly label: string | null;
}

export interface DeviceStore {
  /**
   * Register a phone and return the row that was created.
   *
   * The id is minted here, not accepted from the caller. A client-supplied
   * primary key would let one account name a row belonging to another and
   * either collide with it or overwrite it; generating it makes that
   * unrepresentable rather than something a handler must remember to guard.
   *
   * `kind` is fixed to `phone`. A headset has no credential until it has
   * paired, so it can never legitimately reach an authenticated route, and a
   * parameter whose only other value is one the caller must not choose is a
   * parameter worth not having.
   */
  registerPhone(input: RegisterPhone): Promise<DeviceRecord>;

  /** One device, if this account owns it and has not forgotten it. */
  find(userId: UserId, deviceId: DeviceId): Promise<DeviceRecord | null>;
}

/** Fresh identifiers. Injected so a test can make a run reproducible. */
export type DeviceIdSource = () => DeviceId;

/**
 * The internal superset a stored row actually carries. `DeviceRecord` stays
 * exactly as documented above — nothing that reads it publicly gains access
 * to key material — but the row behind it must hold a headset's key
 * somewhere, or `headsetKeyOf` below has nothing to read. Mirrors how
 * `pairing-sessions.ts`'s internal `SessionRow` already carries more fields
 * than any single public return type exposes.
 */
interface InternalDeviceRow extends DeviceRecord {
  readonly publicKey: Buffer | null;
  readonly publicKeyId: string | null;
}

/**
 * Devices held in memory.
 *
 * What a deployment without a database gets, and what the offline suites use.
 */
export class InMemoryDeviceStore implements DeviceStore {
  readonly #rows = new Map<string, InternalDeviceRow>();
  readonly #newId: DeviceIdSource;
  readonly #now: () => Date;

  constructor(newId: DeviceIdSource = newDeviceId, now: () => Date = () => new Date()) {
    this.#newId = newId;
    this.#now = now;
  }

  async registerPhone(input: RegisterPhone): Promise<DeviceRecord> {
    const row: InternalDeviceRow = {
      id: this.#newId(),
      userId: input.userId,
      kind: 'phone',
      label: input.label,
      registeredAt: this.#now(),
      revokedAt: null,
      publicKey: null,
      publicKeyId: null,
    };
    this.#rows.set(row.id, row);
    return row;
  }

  async find(userId: UserId, deviceId: DeviceId): Promise<DeviceRecord | null> {
    const row = this.#rows.get(deviceId);
    // Scoped by owner, not merely looked up. A find that ignored `userId`
    // would answer "does this device exist" to anybody who guessed an id.
    return row !== undefined && row.userId === userId && row.revokedAt === null ? row : null;
  }

  /**
   * Registers a headset immediately after it has proven possession of its
   * private key during pairing redemption.
   *
   * Not part of `DeviceStore`. A public method here would be a second way to
   * create a headset row — one with no proof requirement behind it — so this
   * exists only on the concrete class, called by `InMemoryPairingSessionStore`
   * from inside the same redemption that just verified the signature. The
   * same reasoning as `consumeIfLive`.
   *
   * Synchronous, and returns the id directly rather than a record: nothing
   * that creates a headset this way needs anything back but the id to close
   * out `pairing_sessions.redeemed_by_device_id`.
   */
  registerHeadset(input: {
    readonly userId: UserId;
    readonly publicKey: Buffer;
    readonly publicKeyId: string;
    readonly keySecurityLevel: KeySecurityLevel | null;
  }): DeviceId {
    const id = this.#newId();
    this.#rows.set(id, {
      id,
      userId: input.userId,
      kind: 'headset',
      label: null,
      registeredAt: this.#now(),
      revokedAt: null,
      publicKey: input.publicKey,
      publicKeyId: input.publicKeyId,
    });
    return id;
  }

  /**
   * Reads a headset's key material for refresh-proof verification.
   *
   * Not part of `DeviceStore`. `DeviceRecord`/`find()` deliberately carry no
   * key material, so `InMemoryDeviceTokenStore.refresh` — the one caller
   * that must verify a signature against this key — reads the internal
   * superset directly instead, the same way `PgDeviceTokenStore.refresh`
   * joins `devices` for `public_key`/`public_key_id` rather than going
   * through this store's own public interface.
   */
  headsetKeyOf(
    deviceId: string,
  ): { readonly publicKey: Buffer; readonly publicKeyId: string; readonly revokedAt: Date | null } | null {
    const row = this.#rows.get(deviceId);
    if (row === undefined || row.publicKey === null || row.publicKeyId === null) return null;
    return { publicKey: row.publicKey, publicKeyId: row.publicKeyId, revokedAt: row.revokedAt };
  }
}

/**
 * Devices in Postgres.
 *
 * Reads filter out revoked rows, for the same reason `PgCompanionBindings`
 * filters on `active`: treating "registered once" as "registered now" would
 * make forgetting a device decorative.
 */
export class PgDeviceStore implements DeviceStore {
  readonly #pool: Pool;
  readonly #newId: DeviceIdSource;

  constructor(pool: Pool, newId: DeviceIdSource = newDeviceId) {
    this.#pool = pool;
    this.#newId = newId;
  }

  async registerPhone(input: RegisterPhone): Promise<DeviceRecord> {
    const id = this.#newId();
    const result = await this.#pool.query<DeviceRow>(
      `insert into devices (id, user_id, kind, label)
       values ($1, $2, 'phone', $3)
       returning id, user_id, kind, label, registered_at, revoked_at`,
      [id, input.userId, input.label],
    );

    const row = result.rows[0];
    if (row === undefined) {
      // An insert with no conflict target cannot return zero rows; if it ever
      // does, something is wrong enough that inventing a device would be worse
      // than failing loudly.
      throw new Error('device registration returned no row');
    }
    return toRecord(row);
  }

  async find(userId: UserId, deviceId: DeviceId): Promise<DeviceRecord | null> {
    const result = await this.#pool.query<DeviceRow>(
      `select id, user_id, kind, label, registered_at, revoked_at
         from devices
        where id = $1 and user_id = $2 and revoked_at is null`,
      [deviceId, userId],
    );

    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }
}

interface DeviceRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: string;
  readonly label: string | null;
  readonly registered_at: Date;
  readonly revoked_at: Date | null;
}

const toRecord = (row: DeviceRow): DeviceRecord => ({
  id: row.id as DeviceId,
  userId: row.user_id as UserId,
  kind: row.kind as DeviceKind,
  label: row.label,
  registeredAt: row.registered_at,
  revokedAt: row.revoked_at,
});
