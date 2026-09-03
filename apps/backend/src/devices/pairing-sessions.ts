import type { Pool } from 'pg';
import { newPairingSessionId, type DeviceId, type PairingSessionId, type UserId } from '@nexa/shared';
import { randomSecret, hashSecret } from './secrets.js';
import type { InMemoryEnrolmentStore } from './enrolments.js';

/**
 * Turning a headset's published key into a pairing session an authenticated
 * phone can show as a code.
 *
 * NX2 step 6: the phone resolves the handle it learned over the local
 * channel and asks the backend to bind a session to whatever key that handle
 * names. This is the one place an enrolment stops being just a published key
 * and becomes part of an account's pairing attempt — which is why creating a
 * session is also what *consumes* the enrolment. An enrolment is meant for
 * exactly one session; once one exists, resolving the same handle again must
 * find nothing, the same way redeeming an already-redeemed code must.
 *
 * ## Why this store, and not `EnrolmentStore`, owns the consuming read
 *
 * Consuming an enrolment and creating the session it feeds are one domain
 * operation spanning two tables, and they must succeed or fail together —
 * a session that names a key from an enrolment that was never actually
 * marked consumed would let that handle be resolved twice. `EnrolmentStore`
 * never needs to consume anything on its own, so the atomicity belongs here,
 * where both writes are already being made in one transaction.
 */

export type CreatePairingSessionInput = {
  readonly userId: UserId;
  readonly phoneDeviceId: DeviceId;
  /**
   * Plaintext, exactly as the phone read it off the local channel. Hashed
   * immediately and never persisted, logged, or echoed back — see
   * `hashSecret` and the route that calls this.
   */
  readonly enrolmentHandle: string;
};

/**
 * What the phone receives, and the only place the plaintext code exists
 * outside the process that just generated it. Nothing downstream of this
 * value persists it — only `code_hash` lives on.
 */
export interface PairingSessionIssued {
  readonly pairingSessionId: PairingSessionId;
  /** `NX2.<43-char base64url secret>` — exactly what the phone displays. */
  readonly code: string;
  readonly expiresAt: Date;
}

export type CreatePairingSessionResult =
  | { readonly ok: true; readonly session: PairingSessionIssued }
  | { readonly ok: false; readonly reason: 'enrolment_invalid' };

export interface PairingSessionStore {
  /**
   * Resolve an enrolment handle and, if it is genuinely live, consume it and
   * mint a session bound to the key it named.
   *
   * `enrolment_invalid` is the only failure this reports, deliberately
   * covering "no such handle", "already consumed" and "expired" alike — the
   * same reasoning `pairing_sessions` redemption already documents: the
   * caller cannot act differently on any of the three, and distinguishing
   * them would only hand a prober information about handles it does not
   * hold.
   */
  create(input: CreatePairingSessionInput): Promise<CreatePairingSessionResult>;
}

/** Long enough to hold a code on screen; short enough that leaving it up costs little. */
const PAIRING_SESSION_TTL_MS = 2 * 60 * 1000;

export type PairingSessionIdSource = () => PairingSessionId;
export type CodeSource = () => string;

const randomCode: CodeSource = randomSecret;

/**
 * Pairing sessions held in memory, sharing rows with an
 * `InMemoryEnrolmentStore` exactly as the Postgres pair shares one physical
 * `device_enrolments` table.
 */
export class InMemoryPairingSessionStore implements PairingSessionStore {
  readonly #enrolments: InMemoryEnrolmentStore;
  readonly #newId: PairingSessionIdSource;
  readonly #newCode: CodeSource;
  readonly #now: () => Date;

  constructor(
    enrolments: InMemoryEnrolmentStore,
    newId: PairingSessionIdSource = newPairingSessionId,
    newCode: CodeSource = randomCode,
    now: () => Date = () => new Date(),
  ) {
    this.#enrolments = enrolments;
    this.#newId = newId;
    this.#newCode = newCode;
    this.#now = now;
  }

  async create(input: CreatePairingSessionInput): Promise<CreatePairingSessionResult> {
    const id = this.#newId();
    const now = this.#now();

    const consumed = this.#enrolments.consumeIfLive(hashSecret(input.enrolmentHandle), id, now);
    if (consumed === null) return { ok: false, reason: 'enrolment_invalid' };

    const code = this.#newCode();
    const expiresAt = new Date(now.getTime() + PAIRING_SESSION_TTL_MS);

    return {
      ok: true,
      session: { pairingSessionId: id, code: `NX2.${code}`, expiresAt },
    };
  }
}

/**
 * Pairing sessions in Postgres, against `pairing_sessions` and
 * `device_enrolments` exactly as `0005_devices_and_pairing.sql` and
 * `0006_device_enrolments.sql` define them. No new migration was required —
 * every column this writes already exists.
 */
export class PgPairingSessionStore implements PairingSessionStore {
  readonly #pool: Pool;
  readonly #newId: PairingSessionIdSource;
  readonly #newCode: CodeSource;

  constructor(pool: Pool, newId: PairingSessionIdSource = newPairingSessionId, newCode: CodeSource = randomCode) {
    this.#pool = pool;
    this.#newId = newId;
    this.#newCode = newCode;
  }

  async create(input: CreatePairingSessionInput): Promise<CreatePairingSessionResult> {
    const id = this.#newId();
    const handleHash = hashSecret(input.enrolmentHandle);

    const client = await this.#pool.connect();
    try {
      await client.query('begin');

      // The single statement that makes this safe under concurrency: two
      // requests racing to resolve the same handle can both reach this line,
      // but Postgres's row lock on the matching `device_enrolments` row
      // admits only one matching UPDATE. The other finds zero rows, exactly
      // as it would have found the row already consumed a moment later.
      //
      // `consumed_by_session_id` is deliberately NOT set here. It has a live
      // foreign key into `pairing_sessions`, and that row does not exist
      // yet — the session's own headset columns come FROM this enrolment, so
      // the session cannot be inserted first either. The two updates below
      // resolve the ordering without weakening the constraint: this one marks
      // the row spent immediately (closing the race), the second, once the
      // session row exists, records which one.
      const consumed = await client.query<{
        readonly id: string;
        readonly public_key: Buffer;
        readonly public_key_id: string;
        readonly key_security_level: string | null;
      }>(
        `update device_enrolments
            set consumed_at = now()
          where handle_hash = $1
            and consumed_at is null
            and expires_at > now()
          returning id, public_key, public_key_id, key_security_level`,
        [handleHash],
      );

      const enrolment = consumed.rows[0];
      if (enrolment === undefined) {
        await client.query('rollback');
        return { ok: false, reason: 'enrolment_invalid' };
      }

      const code = this.#newCode();
      const codeHash = hashSecret(code);
      const expiresAt = new Date(Date.now() + PAIRING_SESSION_TTL_MS);

      const inserted = await client.query<{ readonly expires_at: Date }>(
        `insert into pairing_sessions
           (id, user_id, phone_device_id, code_hash,
            headset_public_key, headset_public_key_id, headset_key_security_level, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning expires_at`,
        [
          id,
          input.userId,
          input.phoneDeviceId,
          codeHash,
          enrolment.public_key,
          enrolment.public_key_id,
          enrolment.key_security_level,
          expiresAt,
        ],
      );

      // Now that the session row exists, closing the audit trail the
      // migration's own check constraint asks for: a consumed enrolment
      // must name the session it fed.
      await client.query('update device_enrolments set consumed_by_session_id = $2 where id = $1', [
        enrolment.id,
        id,
      ]);

      await client.query('commit');

      const row = inserted.rows[0];
      if (row === undefined) {
        // Reached only if the insert itself returned no row despite
        // committing, which should be unreachable — an insert with no
        // conflict target either fails the whole statement or returns one
        // row. Treated as a hard failure rather than a silent success.
        throw new Error('pairing session insert returned no row');
      }

      return {
        ok: true,
        session: { pairingSessionId: id, code: `NX2.${code}`, expiresAt: row.expires_at },
      };
    } catch (error) {
      await client.query('rollback').catch(() => {
        // The transaction may already be aborted by the error above; a
        // failed rollback here must not shadow the original failure.
      });
      throw error;
    } finally {
      client.release();
    }
  }
}
