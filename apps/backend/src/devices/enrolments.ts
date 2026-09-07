import type { Pool } from 'pg';
import { newEnrolmentId, type EnrolmentId } from '@nexa/shared';
import { randomSecret, hashSecret } from './secrets.js';

/**
 * Publishing a headset's public key before it belongs to anyone.
 *
 * NX2 step 2: the headset enrols the *public* half of a key it generated
 * itself, and gets back a short-lived handle. The local channel that follows
 * — Bluetooth, the local network, or a person reading a screen — carries only
 * that handle, never the key. See `supabase/migrations/0006_device_enrolments.sql`
 * for why: a handle is a pointer an authenticated phone resolves, and moving
 * the key itself over an unauthenticated local channel would make that
 * channel responsible for a trust decision it cannot make.
 *
 * This is a port with two adapters for the same reason `DeviceStore` is: the
 * offline suites must run with no database.
 */

/** Mirrors the `device_enrolments_key_security_level_check` constraint. */
export type KeySecurityLevel = 'software' | 'tee' | 'strongbox' | 'unknown';

export const KEY_SECURITY_LEVELS: readonly KeySecurityLevel[] = [
  'software',
  'tee',
  'strongbox',
  'unknown',
];

export interface EnrolHeadsetKey {
  /** The validated SPKI DER — already parsed and confirmed to be P-256. */
  readonly publicKey: Buffer;
  /** Derived from `publicKey` by the caller, never accepted from a request body. */
  readonly publicKeyId: string;
  /**
   * As the device reported it. Self-reported, and this store treats it as
   * exactly that — see `parseP256Spki` and the migration's own comment for
   * why it is metadata, not a security guarantee.
   */
  readonly keySecurityLevel: KeySecurityLevel | null;
}

/**
 * What the headset receives, and the only place the plaintext handle exists
 * outside the process that just generated it.
 *
 * Nothing in this type, or anywhere upstream of it, persists `handle`. Once
 * this value is handed to the caller and the response is sent, the plaintext
 * is gone — only its hash lives on in the store.
 */
export interface HandleIssued {
  readonly enrolmentId: EnrolmentId;
  readonly handle: string;
  readonly expiresAt: Date;
}

export interface EnrolmentStore {
  /**
   * Record a headset's public key and mint the handle a local channel will
   * later carry to an authenticated phone.
   *
   * Deliberately the only method here. Resolving a handle back into a public
   * key belongs to pairing-session creation, which does not exist yet — an
   * unused method on this port would be surface nothing calls and nothing
   * tests.
   */
  enrol(input: EnrolHeadsetKey): Promise<HandleIssued>;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Fresh identifiers. Injected so a test can make a run reproducible. */
export type EnrolmentIdSource = () => EnrolmentId;

/** 256 bits of CSPRNG output, base64url-encoded. Injected so a test can pin the value. */
export type HandleSource = () => string;

export const randomHandle: HandleSource = randomSecret;

/**
 * SHA-256 of the handle, base64url. The one-way step that makes it safe for
 * the hash to live in a database a `SELECT *` could reach.
 */
const hashHandle = hashSecret;

/**
 * Enrolments held in memory.
 *
 * What a deployment without a database gets, and what the offline suites use.
 */
interface EnrolmentRow {
  readonly publicKey: Buffer;
  readonly publicKeyId: string;
  readonly keySecurityLevel: KeySecurityLevel | null;
  readonly handleHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  consumedAt: Date | null;
  consumedBySessionId: string | null;
}

export class InMemoryEnrolmentStore implements EnrolmentStore {
  readonly #rows = new Map<string, EnrolmentRow>();

  readonly #newId: EnrolmentIdSource;
  readonly #newHandle: HandleSource;
  readonly #now: () => Date;

  constructor(
    newId: EnrolmentIdSource = newEnrolmentId,
    newHandle: HandleSource = randomHandle,
    now: () => Date = () => new Date(),
  ) {
    this.#newId = newId;
    this.#newHandle = newHandle;
    this.#now = now;
  }

  async enrol(input: EnrolHeadsetKey): Promise<HandleIssued> {
    const id = this.#newId();
    const handle = this.#newHandle();
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + FIVE_MINUTES_MS);

    this.#rows.set(id, {
      publicKey: input.publicKey,
      publicKeyId: input.publicKeyId,
      keySecurityLevel: input.keySecurityLevel,
      handleHash: hashHandle(handle),
      createdAt,
      expiresAt,
      consumedAt: null,
      consumedBySessionId: null,
    });

    return { enrolmentId: id, handle, expiresAt };
  }

  /**
   * Atomically consumes a live enrolment by its handle hash, or reports that
   * none exists.
   *
   * The in-memory analogue of the conditional
   * `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()` that
   * `PgPairingSessionStore` issues directly against `device_enrolments`. Node
   * is single-threaded and this method contains no `await`, so nothing can
   * interleave between the check and the write — the same guarantee
   * Postgres's row locking provides the real predicate.
   *
   * Not part of `EnrolmentStore`. Consuming an enrolment is not something
   * enrolment itself ever needs to do — only pairing-session creation does,
   * so this lives where that atomicity is actually owned.
   */
  consumeIfLive(
    handleHash: string,
    consumedBySessionId: string,
    now: Date,
  ): { readonly publicKey: Buffer; readonly publicKeyId: string; readonly keySecurityLevel: KeySecurityLevel | null } | null {
    for (const row of this.#rows.values()) {
      if (row.handleHash !== handleHash) continue;
      if (row.consumedAt !== null) return null;
      if (row.expiresAt.getTime() <= now.getTime()) return null;

      row.consumedAt = now;
      row.consumedBySessionId = consumedBySessionId;
      return { publicKey: row.publicKey, publicKeyId: row.publicKeyId, keySecurityLevel: row.keySecurityLevel };
    }
    return null;
  }

  /** Test-only: what actually got persisted, to prove the plaintext handle never did. */
  peek(id: EnrolmentId) {
    return this.#rows.get(id) ?? null;
  }
}

/**
 * Enrolments in Postgres, against `device_enrolments` exactly as
 * `0006_device_enrolments.sql` defines it.
 */
export class PgEnrolmentStore implements EnrolmentStore {
  readonly #pool: Pool;
  readonly #newId: EnrolmentIdSource;
  readonly #newHandle: HandleSource;

  constructor(
    pool: Pool,
    newId: EnrolmentIdSource = newEnrolmentId,
    newHandle: HandleSource = randomHandle,
  ) {
    this.#pool = pool;
    this.#newId = newId;
    this.#newHandle = newHandle;
  }

  async enrol(input: EnrolHeadsetKey): Promise<HandleIssued> {
    const id = this.#newId();
    const handle = this.#newHandle();
    const handleHash = hashHandle(handle);
    const expiresAt = new Date(Date.now() + FIVE_MINUTES_MS);

    const result = await this.#pool.query<{ readonly expires_at: Date }>(
      `insert into device_enrolments
         (id, handle_hash, public_key, public_key_id, key_security_level, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       returning expires_at`,
      [id, handleHash, input.publicKey, input.publicKeyId, input.keySecurityLevel, expiresAt],
    );

    const row = result.rows[0];
    if (row === undefined) {
      // An insert with no conflict target cannot return zero rows; if it
      // ever does, something is wrong enough that inventing a handle would
      // be worse than failing loudly.
      throw new Error('enrolment insert returned no row');
    }

    return { enrolmentId: id, handle, expiresAt: row.expires_at };
  }
}
