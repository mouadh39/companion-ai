import type { Pool } from 'pg';
import {
  newDeviceId,
  newPairingSessionId,
  trustExternalId,
  type DeviceId,
  type PairingSessionId,
  type UserId,
} from '@nexa/shared';
import { randomSecret, hashSecret } from './secrets.js';
import { buildChallenge, verifyChallenge } from './challenge.js';
import type { InMemoryEnrolmentStore } from './enrolments.js';
import type { InMemoryDeviceStore } from './store.js';
import type { KeySecurityLevel } from './enrolments.js';
import { mintFamilyRoot, asCredentials, type InMemoryDeviceTokenStore } from './tokens.js';

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

export interface RedeemPairingSessionInput {
  /**
   * The code exactly as the headset read it, WITHOUT the `NX2.` prefix — the
   * caller (the route) strips it, since prefix validation is a request-shape
   * concern and this store's job starts at the secret itself.
   */
  readonly secret: string;
  /**
   * The headset's raw ECDSA signature bytes, ASN.1 DER encoded, already
   * decoded from whatever transport encoding the request used. Verified
   * against the challenge built from server-side values only — see
   * `buildChallenge` and `verifyChallenge`.
   */
  readonly signature: Buffer;
}

/** What a successful redemption hands back — a new headset identity, already credentialed. */
export interface RedeemedPairingSession {
  readonly deviceId: DeviceId;
  readonly accessToken: string;
  /** Plaintext, returned exactly once. Never persisted — only its hash is. */
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

/**
 * `redemption_invalid` is the single failure this reports, deliberately
 * covering "no such code", "expired", "already redeemed", "cancelled" and
 * "wrong signature" alike. A caller — legitimate or not — cannot act
 * differently on any of these, and distinguishing them in the response would
 * hand a prober exactly the information it should never get: which of its
 * guesses came closer. The one exception is a signature that failed to
 * verify, which additionally counts against the session's `attempt_count` —
 * see `PgPairingSessionStore.redeem`.
 */
export type RedeemPairingSessionResult =
  | { readonly ok: true; readonly redeemed: RedeemedPairingSession }
  | { readonly ok: false; readonly reason: 'redemption_invalid' };

/**
 * A session's state as reported to the account that created it — never to
 * anyone else. Matches `pairing_sessions_status_check`'s own vocabulary
 * exactly, plus the one value that check constraint permits but nothing
 * today ever writes: `expired` is computed at read time from `expires_at`,
 * the same way `redeem` itself already treats expiry, rather than requiring
 * a background job to flip a stored value the instant a session's TTL
 * passes.
 */
export type PairingSessionStatusValue = 'pending' | 'redeemed' | 'expired' | 'cancelled' | 'failed';

export interface PairingSessionStatusInput {
  /** Not yet known to be a real id, or to belong to this caller — see `getStatus`. */
  readonly pairingSessionId: string;
  /** From the verified caller's token — never a claim the request could make. */
  readonly userId: UserId;
}

/**
 * Exactly what a phone is owed about its own pairing attempt, and nothing a
 * headset's identity, a signature, or a credential could be reconstructed
 * from. See `getStatus`'s own doc for the full reasoning.
 */
export interface PairingSessionStatusInfo {
  readonly status: PairingSessionStatusValue;
  /** The headset's own device id once `status` is `redeemed`; `null` before then. */
  readonly deviceId: DeviceId | null;
}

/**
 * `not_found` is the single failure this reports, deliberately covering both
 * "no such session" and "a session that exists but belongs to a different
 * account" — the same reasoning every other lookup in this module already
 * documents (`create`'s `enrolment_invalid`, `redeem`'s
 * `redemption_invalid`): distinguishing "not yours" from "does not exist"
 * would hand a caller an existence oracle over sessions, and therefore
 * pairing attempts, it has no claim to.
 */
export type GetPairingSessionStatusResult =
  | { readonly ok: true; readonly info: PairingSessionStatusInfo }
  | { readonly ok: false; readonly reason: 'not_found' };

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

  /**
   * Prove possession of the private key bound to a pending session and, if
   * the proof holds, register the headset, mark the session redeemed, and
   * mint its first `device_tokens` family root — access token and refresh
   * token both, in the one transaction that also creates the headset.
   *
   * Deliberately the operation that verifies the proof, performs the state
   * change, AND issues the resulting credentials, rather than three calls a
   * route would have to sequence correctly itself — the same "one domain
   * operation, one owner" reasoning `create` already documents, extended to
   * a third table. Exactly one headset identity, and exactly one token
   * family, ever come from a given redemption.
   *
   * Creates no companion binding.
   */
  redeem(input: RedeemPairingSessionInput): Promise<RedeemPairingSessionResult>;

  /**
   * Reports a session's state to the account that created it — the only
   * authoritative way a phone can ever learn that its headset actually
   * redeemed, since `redeem` itself is an unauthenticated, headset-only call
   * this phone is never party to.
   *
   * Ownership is checked as part of the same lookup that finds the row, not
   * as a separate step afterward — see each implementation's own query —
   * so there is no window in which a session's existence is confirmed before
   * its ownership is.
   */
  getStatus(input: PairingSessionStatusInput): Promise<GetPairingSessionStatusResult>;
}

/** Long enough to hold a code on screen; short enough that leaving it up costs little. */
const PAIRING_SESSION_TTL_MS = 2 * 60 * 1000;

export type PairingSessionIdSource = () => PairingSessionId;
export type CodeSource = () => string;

const randomCode: CodeSource = randomSecret;

interface SessionRow {
  readonly id: PairingSessionId;
  readonly userId: UserId;
  readonly codeHash: string;
  readonly headsetPublicKey: Buffer;
  readonly headsetPublicKeyId: string;
  readonly headsetKeySecurityLevel: KeySecurityLevel | null;
  status: 'pending' | 'redeemed' | 'expired' | 'cancelled' | 'failed';
  attemptCount: number;
  readonly expiresAt: Date;
  redeemedAt: Date | null;
  redeemedByDeviceId: DeviceId | null;
}

/**
 * Pairing sessions held in memory, sharing rows with an
 * `InMemoryEnrolmentStore` and an `InMemoryDeviceStore` exactly as the
 * Postgres trio shares three physical tables.
 */
export class InMemoryPairingSessionStore implements PairingSessionStore {
  readonly #sessions = new Map<string, SessionRow>();

  readonly #enrolments: InMemoryEnrolmentStore;
  readonly #devices: InMemoryDeviceStore;
  readonly #tokens: InMemoryDeviceTokenStore;
  readonly #deviceTokenSecret: string;
  readonly #newId: PairingSessionIdSource;
  readonly #newCode: CodeSource;
  readonly #now: () => Date;

  constructor(
    enrolments: InMemoryEnrolmentStore,
    devices: InMemoryDeviceStore,
    tokens: InMemoryDeviceTokenStore,
    deviceTokenSecret: string,
    newId: PairingSessionIdSource = newPairingSessionId,
    newCode: CodeSource = randomCode,
    now: () => Date = () => new Date(),
  ) {
    this.#enrolments = enrolments;
    this.#devices = devices;
    this.#tokens = tokens;
    this.#deviceTokenSecret = deviceTokenSecret;
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

    this.#sessions.set(id, {
      id,
      userId: input.userId,
      codeHash: hashSecret(code),
      headsetPublicKey: consumed.publicKey,
      headsetPublicKeyId: consumed.publicKeyId,
      headsetKeySecurityLevel: consumed.keySecurityLevel,
      status: 'pending',
      attemptCount: 0,
      expiresAt,
      redeemedAt: null,
      redeemedByDeviceId: null,
    });

    return {
      ok: true,
      session: { pairingSessionId: id, code: `NX2.${code}`, expiresAt },
    };
  }

  async redeem(input: RedeemPairingSessionInput): Promise<RedeemPairingSessionResult> {
    const codeHash = hashSecret(input.secret);
    let found: SessionRow | undefined;
    for (const row of this.#sessions.values()) {
      if (row.codeHash === codeHash) {
        found = row;
        break;
      }
    }

    const fail = (): RedeemPairingSessionResult => ({ ok: false, reason: 'redemption_invalid' });

    if (found === undefined) return fail();
    if (found.status !== 'pending' || found.expiresAt.getTime() <= this.#now().getTime()) return fail();

    const challenge = buildChallenge({
      pairingSessionId: found.id,
      secret: input.secret,
      headsetPublicKeyId: found.headsetPublicKeyId,
    });
    const verdict = verifyChallenge(found.headsetPublicKey, challenge, input.signature);

    if (verdict !== 'valid') {
      // Counted, never burned. A wrong signature costs the caller nothing
      // about the session's own state — see the module doc on `redeem`.
      found.attemptCount += 1;
      return fail();
    }

    // No `await` between the check above and the claim below — through to
    // `found.status = 'redeemed'` — so nothing can interleave in a
    // single-threaded process: the in-memory analogue of the atomic
    // conditional UPDATE the Postgres store issues. Signing the access
    // token IS awaited, but only once this block has already run to
    // completion — by the time anything yields to the event loop, exactly
    // one caller has already claimed the session, registered the headset,
    // and inserted its token family. An `await` any earlier than this would
    // let two concurrent callers both pass every check above before either
    // writes, exactly the race this comment exists to prevent.
    if (found.status !== 'pending' || found.expiresAt.getTime() <= this.#now().getTime()) return fail();

    const deviceId = this.#devices.registerHeadset({
      userId: found.userId,
      publicKey: found.headsetPublicKey,
      publicKeyId: found.headsetPublicKeyId,
      keySecurityLevel: found.headsetKeySecurityLevel,
    });

    const now = this.#now();
    const rootPrepared = mintFamilyRoot(now);
    this.#tokens.insertRoot(rootPrepared, deviceId, found.userId);

    found.status = 'redeemed';
    found.redeemedAt = now;
    found.redeemedByDeviceId = deviceId;

    const credentials = await asCredentials(this.#deviceTokenSecret, found.userId, rootPrepared);

    return {
      ok: true,
      redeemed: {
        deviceId,
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresInSeconds: credentials.expiresInSeconds,
      },
    };
  }

  async getStatus(input: PairingSessionStatusInput): Promise<GetPairingSessionStatusResult> {
    const row = this.#sessions.get(input.pairingSessionId);

    // Ownership checked as part of the same lookup, not after it — a row
    // that exists but belongs to someone else is indistinguishable here
    // from one that does not exist at all. See the interface's own doc.
    if (row === undefined || row.userId !== input.userId) return { ok: false, reason: 'not_found' };

    return {
      ok: true,
      info: {
        status: this.#effectiveStatus(row),
        deviceId: row.redeemedByDeviceId,
      },
    };
  }

  /**
   * `expired` is never stored — see `PairingSessionStatusValue`'s own doc —
   * so a `pending` row past its own `expiresAt` is reported as `expired`
   * here, computed fresh on every read, the same way `redeem` itself already
   * treats expiry rather than trusting a stale stored value.
   */
  #effectiveStatus(row: SessionRow): PairingSessionStatusValue {
    if (row.status === 'pending' && row.expiresAt.getTime() <= this.#now().getTime()) {
      return 'expired';
    }
    return row.status;
  }
}

/**
 * Refuses every pairing session. What a deployment gets when
 * `NEXA_DEVICE_TOKEN_SECRET` is not configured — the same reasoning
 * `DenyAllAuthenticator` documents for a missing Supabase secret, applied
 * here because `redeem` cannot safely issue a headset credential with no
 * secret to sign it with. Failing every step, rather than only the final
 * signing call, keeps the failure at the boundary a deployment operator
 * actually looks at first — pairing simply does not start — instead of a
 * phone successfully creating a session that can never be redeemed.
 */
export class DenyAllPairingSessionStore implements PairingSessionStore {
  async create(): Promise<CreatePairingSessionResult> {
    return { ok: false, reason: 'enrolment_invalid' };
  }

  async redeem(): Promise<RedeemPairingSessionResult> {
    return { ok: false, reason: 'redemption_invalid' };
  }

  async getStatus(): Promise<GetPairingSessionStatusResult> {
    return { ok: false, reason: 'not_found' };
  }
}

export type DeviceIdSource = () => DeviceId;

/**
 * Pairing sessions in Postgres, against `pairing_sessions`, `devices` and
 * `device_enrolments` exactly as `0005_devices_and_pairing.sql` and
 * `0006_device_enrolments.sql` define them. No new migration was required —
 * every column this writes already exists.
 */
export class PgPairingSessionStore implements PairingSessionStore {
  readonly #pool: Pool;
  readonly #deviceTokenSecret: string;
  readonly #newId: PairingSessionIdSource;
  readonly #newCode: CodeSource;
  readonly #newDeviceId: DeviceIdSource;

  constructor(
    pool: Pool,
    deviceTokenSecret: string,
    newId: PairingSessionIdSource = newPairingSessionId,
    newCode: CodeSource = randomCode,
    newDeviceIdSource: DeviceIdSource = newDeviceId,
  ) {
    this.#pool = pool;
    this.#deviceTokenSecret = deviceTokenSecret;
    this.#newId = newId;
    this.#newCode = newCode;
    this.#newDeviceId = newDeviceIdSource;
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

  /**
   * Verifies proof of possession and, if it holds, registers the headset and
   * marks the session redeemed — all against live production data, so every
   * step is deliberate about what it trusts and when it writes.
   *
   * ## The shape of this method, in order
   *
   * 1. **Resolve** the session by `code_hash` — a plain read, no lock, no
   *    transaction yet. Nothing about this read needs to be atomic with what
   *    follows: whatever it sees, the state transition at the end re-checks
   *    the same predicate for real.
   * 2. **Reject early** if the session is not `pending` or has expired —
   *    without touching cryptography, since there is no point verifying a
   *    signature against a session that cannot be redeemed regardless of the
   *    answer.
   * 3. **Verify** the signature against a challenge built entirely from what
   *    step 1 returned — `pairingSessionId`, `secret` (from the caller, but
   *    only meaningful because it hashed to this exact row), and
   *    `headsetPublicKeyId` (from the row, never from the caller). Pure
   *    computation; nothing is written yet.
   * 4. **On failure**, count the attempt and stop. The session's `status`
   *    does not change — see below for why that matters.
   * 5. **On success**, one transaction: insert the headset's `devices` row,
   *    then the atomic conditional `UPDATE` that is this method's actual
   *    concurrency guarantee — see the comment on that statement.
   *
   * ## Why a bad signature does not burn the session
   *
   * `pairing_sessions.attempt_count` exists in the schema for exactly this:
   * a photographed QR handed to a second, illegitimate device yields a
   * signature that will never verify, no matter how many times it is tried
   * — and marking the session `failed` on the first wrong attempt would let
   * that second device deny service to the legitimate headset still holding
   * the real key. Rate limiting (see the route) bounds the cost of retrying;
   * the session itself stays `pending` until either a valid proof redeems it
   * or it genuinely expires.
   */
  async redeem(input: RedeemPairingSessionInput): Promise<RedeemPairingSessionResult> {
    const fail = (): RedeemPairingSessionResult => ({ ok: false, reason: 'redemption_invalid' });
    const codeHash = hashSecret(input.secret);

    const found = await this.#pool.query<{
      readonly id: string;
      readonly user_id: string;
      readonly status: string;
      readonly expires_at: Date;
      readonly headset_public_key: Buffer;
      readonly headset_public_key_id: string;
      readonly headset_key_security_level: string | null;
    }>(
      `select id, user_id, status, expires_at,
              headset_public_key, headset_public_key_id, headset_key_security_level
         from pairing_sessions
        where code_hash = $1`,
      [codeHash],
    );

    const session = found.rows[0];
    if (session === undefined) return fail();
    if (session.status !== 'pending' || session.expires_at.getTime() <= Date.now()) return fail();

    const challenge = buildChallenge({
      pairingSessionId: session.id,
      secret: input.secret,
      headsetPublicKeyId: session.headset_public_key_id,
    });
    const verdict = verifyChallenge(session.headset_public_key, challenge, input.signature);

    if (verdict !== 'valid') {
      // Not transactional with anything else, and deliberately not: a lost
      // increment under a rare concurrent bad guess is imprecise telemetry,
      // not a correctness failure, and this write must never be allowed to
      // block or be blocked by a legitimate redemption in flight.
      await this.#pool
        .query('update pairing_sessions set attempt_count = attempt_count + 1 where id = $1', [session.id])
        .catch(() => {
          // Logged nowhere further up on purpose: failing to record an
          // attempt must never turn into failing the caller's request.
        });
      return fail();
    }

    const deviceId = this.#newDeviceId();
    const client = await this.#pool.connect();
    try {
      await client.query('begin');

      await client.query(
        `insert into devices (id, user_id, kind, public_key, public_key_id, key_security_level)
         values ($1, $2, 'headset', $3, $4, $5)`,
        [
          deviceId,
          session.user_id,
          session.headset_public_key,
          session.headset_public_key_id,
          session.headset_key_security_level,
        ],
      );

      // The single statement that makes concurrent redemption safe: two
      // requests that both verified a genuinely valid signature — the
      // ordinary shape of a race, and also what a replayed signature looks
      // like — can both reach this line, but only one `UPDATE` can match a
      // row still `pending`. The other affects zero rows and rolls back,
      // undoing only the device row it just inserted.
      const updated = await client.query<{ readonly id: string }>(
        `update pairing_sessions
            set status = 'redeemed', redeemed_at = now(), redeemed_by_device_id = $2
          where id = $1
            and status = 'pending'
            and expires_at > now()
          returning id`,
        [session.id, deviceId],
      );

      if (updated.rows.length === 0) {
        await client.query('rollback');
        return fail();
      }

      // The token family's root, in the same transaction that just created
      // the headset — the two either both exist or neither does. `family_id`
      // equals its own `id`: this row IS the family's origin, exactly as
      // `mintFamilyRoot` documents.
      const userId = trustExternalId<UserId>(session.user_id);
      const rootPrepared = mintFamilyRoot();
      await client.query(
        `insert into device_tokens
           (id, family_id, family_issued_at, device_id, user_id, token_hash, issued_at, expires_at)
         values ($1, $1, $2, $3, $4, $5, $2, $6)`,
        [
          rootPrepared.id,
          rootPrepared.issuedAt,
          deviceId,
          userId,
          rootPrepared.refreshTokenHash,
          rootPrepared.expiresAt,
        ],
      );

      await client.query('commit');

      const credentials = await asCredentials(this.#deviceTokenSecret, userId, rootPrepared);
      return {
        ok: true,
        redeemed: {
          deviceId,
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          expiresInSeconds: credentials.expiresInSeconds,
        },
      };
    } catch (error) {
      await client.query('rollback').catch(() => {
        // The transaction may already be aborted by the error above.
      });

      // A live headset with this exact key already exists and was never
      // revoked (`devices_live_key_idx`). Reachable only if the same
      // enrolment key was somehow redeemed before without being revoked
      // first — treated as an ordinary redemption failure, not a crash.
      if ((error as { readonly code?: string }).code === '23505') return fail();
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Ownership enforced in the `where` clause itself — `id = $1 and
   * user_id = $2` — rather than fetched then checked, so a row belonging to
   * a different account never surfaces as a distinguishable "found, but not
   * yours" outcome even one query earlier than the response. See the
   * interface's own doc.
   */
  async getStatus(input: PairingSessionStatusInput): Promise<GetPairingSessionStatusResult> {
    const found = await this.#pool.query<{
      readonly status: string;
      readonly expires_at: Date;
      readonly redeemed_by_device_id: string | null;
    }>(
      `select status, expires_at, redeemed_by_device_id
         from pairing_sessions
        where id = $1
          and user_id = $2`,
      [input.pairingSessionId, input.userId],
    );

    const row = found.rows[0];
    if (row === undefined) return { ok: false, reason: 'not_found' };

    const status: PairingSessionStatusValue =
      row.status === 'pending' && row.expires_at.getTime() <= Date.now()
        ? 'expired'
        : (row.status as PairingSessionStatusValue);

    return {
      ok: true,
      info: {
        status,
        deviceId: row.redeemed_by_device_id === null ? null : trustExternalId<DeviceId>(row.redeemed_by_device_id),
      },
    };
  }
}
