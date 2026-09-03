import type { Pool } from 'pg';
import { newDeviceTokenId, trustExternalId, type DeviceTokenId, type UserId } from '@nexa/shared';
import { randomSecret, hashSecret } from './secrets.js';
import { buildRefreshChallenge, verifyChallenge } from './challenge.js';
import { signDeviceAccessToken } from '../auth/device-token.js';
import type { InMemoryDeviceStore } from './store.js';

/**
 * Refreshing a headset's credentials.
 *
 * Initial issuance happens elsewhere — inside `PairingSessionStore.redeem`,
 * in the same transaction that creates the headset's `devices` row, using
 * `mintFamilyRoot` below. This file owns everything that happens
 * afterward: renewing an access token via a still-live refresh token, and
 * the family-lifetime arithmetic both issuance and renewal share.
 *
 * ## What "family" means here
 *
 * One family is the whole chain of refresh tokens descended from a single
 * redemption — a root row and every row `replaced_by` rotation ever
 * produces from it. `family_id` (added by migration 0007) names the root;
 * `family_issued_at` is copied from the root's own `issued_at` onto every
 * row in the chain, unchanged, so the absolute lifetime check in
 * `computeExpiry` never needs to walk the chain to answer "when did this
 * family begin".
 */

/** A token's own inactivity window: unused this long, it dies even if the family has time left. */
export const FAMILY_INACTIVITY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** The family's hard ceiling from its original issuance. Rotation can never push this out. */
export const FAMILY_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The exact rule migration 0007's `device_tokens_family_lifetime_check`
 * also enforces at the database level: whichever bound is closer, always.
 * Kept here as the one place that decides it, and mirrored in the
 * constraint as a backstop independent of this function ever being called
 * correctly.
 */
export const computeExpiry = (now: Date, familyIssuedAt: Date): Date => {
  const inactivityBound = now.getTime() + FAMILY_INACTIVITY_WINDOW_MS;
  const familyBound = familyIssuedAt.getTime() + FAMILY_MAX_LIFETIME_MS;
  return new Date(Math.min(inactivityBound, familyBound));
};

export interface IssuedCredentials {
  readonly accessToken: string;
  /** Plaintext, returned exactly once. Never persisted — only its hash is. */
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
}

/**
 * The values a fresh `device_tokens` row needs, computed but not yet
 * written — the caller (redeem's own transaction, or `refresh` below)
 * decides how and when to persist them, since each does so differently.
 */
export interface PreparedToken {
  readonly id: DeviceTokenId;
  readonly refreshToken: string;
  readonly refreshTokenHash: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/** A brand new family: this row is its own root. Used only at redemption. */
export const mintFamilyRoot = (now: Date = new Date()): PreparedToken & { readonly familyId: DeviceTokenId } => {
  const id = newDeviceTokenId();
  const refreshToken = randomSecret();
  return {
    id,
    familyId: id,
    refreshToken,
    refreshTokenHash: hashSecret(refreshToken),
    issuedAt: now,
    expiresAt: computeExpiry(now, now),
  };
};

/** The next link in an existing family — `familyIssuedAt` carried forward unchanged. */
export const mintRotation = (familyIssuedAt: Date, now: Date = new Date()): PreparedToken => {
  const refreshToken = randomSecret();
  return {
    id: newDeviceTokenId(),
    refreshToken,
    refreshTokenHash: hashSecret(refreshToken),
    issuedAt: now,
    expiresAt: computeExpiry(now, familyIssuedAt),
  };
};

export type RefreshDeviceTokenResult =
  | { readonly ok: true; readonly credentials: IssuedCredentials }
  | { readonly ok: false; readonly reason: 'refresh_invalid' };

export interface DeviceTokenStore {
  /**
   * Rotates a live refresh token into a fresh access+refresh pair, after
   * verifying proof of possession of the private key bound to the device.
   *
   * `refresh_invalid` deliberately covers every failure alike — unknown
   * token, expired, revoked, an already-rotated token being replayed, a
   * revoked device, a wrong or malformed signature — the same reasoning
   * `PairingSessionStore`'s `enrolment_invalid` and `redemption_invalid`
   * already document: no caller can act differently on any of these, and
   * distinguishing them would only inform a prober which guess was closer.
   */
  refresh(refreshToken: string, signature: Buffer): Promise<RefreshDeviceTokenResult>;
}

const fail = (): RefreshDeviceTokenResult => ({ ok: false, reason: 'refresh_invalid' });

/**
 * Refuses every refresh. What a deployment gets when
 * `NEXA_DEVICE_TOKEN_SECRET` is not configured — the same reasoning
 * `DenyAllAuthenticator` and `DenyAllPairingSessionStore` document: no
 * refresh token this process could issue would ever verify against a secret
 * nobody configured, so failing loudly here is safer than a store that would
 * otherwise work, feeding tokens to an authenticator that will never accept
 * them.
 */
export class DenyAllDeviceTokenStore implements DeviceTokenStore {
  async refresh(): Promise<RefreshDeviceTokenResult> {
    return fail();
  }
}

/**
 * Signs the access JWT and pairs it with the just-minted refresh token.
 *
 * `expiresInSeconds` reports the *refresh* token's remaining lifetime, not
 * the access token's — the access token's is fixed at
 * `ACCESS_TOKEN_TTL_SECONDS` and never needs to be communicated dynamically,
 * while the refresh token's genuinely varies as a family approaches its
 * 90-day cap. Reporting the real, shrinking number is what lets a headset
 * notice it should refresh sooner rather than assume a flat window every
 * time — the whole reason `computeExpiry` exists.
 *
 * Exported because `PairingSessionStore.redeem` needs the identical shaping
 * for a family's very first token, minted by `mintFamilyRoot` rather than
 * `mintRotation` — the one function that decides what an `IssuedCredentials`
 * response looks like, used by both callers that ever produce one.
 */
export const asCredentials = async (
  secret: string,
  userId: UserId,
  prepared: PreparedToken,
): Promise<IssuedCredentials> => {
  const { token } = await signDeviceAccessToken(secret, userId);
  const expiresInSeconds = Math.max(0, Math.round((prepared.expiresAt.getTime() - Date.now()) / 1000));
  return { accessToken: token, refreshToken: prepared.refreshToken, expiresInSeconds };
};

/**
 * Refresh tokens held in memory, sharing device rows with an
 * `InMemoryDeviceStore` exactly as `InMemoryPairingSessionStore` already
 * shares enrolment and device rows with the same instances.
 */
interface InMemoryTokenRow {
  readonly id: DeviceTokenId;
  readonly familyId: DeviceTokenId;
  readonly familyIssuedAt: Date;
  readonly deviceId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: DeviceTokenId | null;
}

/**
 * Refresh tokens held in memory.
 *
 * Owns its own rows — unlike `InMemoryPairingSessionStore`, which shares an
 * `InMemoryEnrolmentStore`'s rows because *consuming* an enrolment is
 * pairing-session's own job, a `device_tokens` row belongs to this store
 * alone. What it shares is only a read: `InMemoryDeviceStore.headsetKeyOf`,
 * the same way any two stores may read facts they do not own.
 *
 * `insertRoot` is not part of `DeviceTokenStore` — a public method here
 * would be a second way to mint a family with no redemption behind it. Only
 * `PairingSessionStore.redeem` ever calls it, holding a reference to this
 * exact instance, mirroring `InMemoryEnrolmentStore.consumeIfLive`.
 */
export class InMemoryDeviceTokenStore implements DeviceTokenStore {
  readonly #rows = new Map<string, InMemoryTokenRow>();
  readonly #devices: InMemoryDeviceStore;
  readonly #secret: string;
  readonly #now: () => Date;

  constructor(devices: InMemoryDeviceStore, secret: string, now: () => Date = () => new Date()) {
    this.#devices = devices;
    this.#secret = secret;
    this.#now = now;
  }

  insertRoot(prepared: PreparedToken & { readonly familyId: DeviceTokenId }, deviceId: string, userId: string): void {
    this.#rows.set(prepared.id, {
      id: prepared.id,
      familyId: prepared.familyId,
      familyIssuedAt: prepared.issuedAt,
      deviceId,
      userId,
      tokenHash: prepared.refreshTokenHash,
      issuedAt: prepared.issuedAt,
      expiresAt: prepared.expiresAt,
      revokedAt: null,
      replacedBy: null,
    });
  }

  async refresh(refreshToken: string, signature: Buffer): Promise<RefreshDeviceTokenResult> {
    const hash = hashSecret(refreshToken);
    let found: InMemoryTokenRow | undefined;
    for (const row of this.#rows.values()) {
      if (row.tokenHash === hash) {
        found = row;
        break;
      }
    }
    if (found === undefined) return fail();

    const now = this.#now();

    // Reuse of an already-rotated token is checked, and acted on, before any
    // cryptography — see the module doc on theft handling.
    if (found.replacedBy !== null) {
      for (const row of this.#rows.values()) {
        if (row.familyId === found.familyId && row.revokedAt === null) row.revokedAt = now;
      }
      return fail();
    }
    if (found.revokedAt !== null) return fail();
    if (found.expiresAt.getTime() <= now.getTime()) return fail();

    const device = this.#devices.headsetKeyOf(found.deviceId);
    if (device === null || device.revokedAt !== null) return fail();

    const challenge = buildRefreshChallenge({
      deviceId: found.deviceId,
      refreshToken,
      headsetPublicKeyId: device.publicKeyId,
    });
    if (verifyChallenge(device.publicKey, challenge, signature) !== 'valid') return fail();

    // No `await` between the check above and the write below — the
    // in-memory analogue of the atomic conditional UPDATE the Postgres
    // store issues, exactly as `InMemoryPairingSessionStore.redeem` already
    // documents for the same reason.
    if (found.replacedBy !== null || found.revokedAt !== null || found.expiresAt.getTime() <= now.getTime()) {
      return fail();
    }

    const prepared = mintRotation(found.familyIssuedAt, now);
    this.#rows.set(prepared.id, {
      id: prepared.id,
      familyId: found.familyId,
      familyIssuedAt: found.familyIssuedAt,
      deviceId: found.deviceId,
      userId: found.userId,
      tokenHash: prepared.refreshTokenHash,
      issuedAt: prepared.issuedAt,
      expiresAt: prepared.expiresAt,
      revokedAt: null,
      replacedBy: null,
    });
    found.replacedBy = prepared.id;

    return {
      ok: true,
      credentials: await asCredentials(this.#secret, trustExternalId<UserId>(found.userId), prepared),
    };
  }
}

/**
 * Refresh tokens in Postgres, against `device_tokens` and `devices` exactly
 * as `0005_devices_and_pairing.sql` and `0007_device_token_families.sql`
 * define them.
 */
export class PgDeviceTokenStore implements DeviceTokenStore {
  readonly #pool: Pool;
  readonly #secret: string;

  constructor(pool: Pool, secret: string) {
    this.#pool = pool;
    this.#secret = secret;
  }

  async refresh(refreshToken: string, signature: Buffer): Promise<RefreshDeviceTokenResult> {
    const hash = hashSecret(refreshToken);

    const found = await this.#pool.query<{
      readonly id: string;
      readonly family_id: string;
      readonly family_issued_at: Date;
      readonly device_id: string;
      readonly user_id: string;
      readonly revoked_at: Date | null;
      readonly replaced_by: string | null;
      readonly expires_at: Date;
      readonly public_key: Buffer;
      readonly public_key_id: string;
      readonly device_revoked_at: Date | null;
    }>(
      `select dt.id, dt.family_id, dt.family_issued_at, dt.device_id, dt.user_id,
              dt.revoked_at, dt.replaced_by, dt.expires_at,
              d.public_key, d.public_key_id, d.revoked_at as device_revoked_at
         from device_tokens dt
         join devices d on d.id = dt.device_id
        where dt.token_hash = $1`,
      [hash],
    );

    const row = found.rows[0];
    if (row === undefined) return fail();

    // Reuse of an already-rotated token: the theft signal, acted on before
    // any cryptography runs at all — see the module doc.
    if (row.replaced_by !== null) {
      await this.#pool.query(
        'update device_tokens set revoked_at = now() where family_id = $1 and revoked_at is null',
        [row.family_id],
      );
      return fail();
    }
    if (row.revoked_at !== null) return fail();
    if (row.expires_at.getTime() <= Date.now()) return fail();
    if (row.device_revoked_at !== null) return fail();

    const challenge = buildRefreshChallenge({
      deviceId: row.device_id,
      refreshToken,
      headsetPublicKeyId: row.public_key_id,
    });
    if (verifyChallenge(row.public_key, challenge, signature) !== 'valid') return fail();

    const prepared = mintRotation(row.family_issued_at);

    const client = await this.#pool.connect();
    try {
      await client.query('begin');

      await client.query(
        `insert into device_tokens
           (id, family_id, family_issued_at, device_id, user_id, token_hash, issued_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          prepared.id,
          row.family_id,
          row.family_issued_at,
          row.device_id,
          row.user_id,
          prepared.refreshTokenHash,
          prepared.issuedAt,
          prepared.expiresAt,
        ],
      );

      // The single statement that makes concurrent refresh safe: two
      // requests that both verified a genuinely valid signature over the
      // same still-live token can both reach this line, but only one
      // `UPDATE` can match a row that is still unrotated, unrevoked and
      // unexpired. The other affects zero rows and rolls back, undoing only
      // the row it just inserted.
      const updated = await client.query<{ readonly id: string }>(
        `update device_tokens
            set replaced_by = $2, last_used_at = now()
          where id = $1
            and replaced_by is null
            and revoked_at is null
            and expires_at > now()
          returning id`,
        [row.id, prepared.id],
      );

      if (updated.rows.length === 0) {
        await client.query('rollback');
        return fail();
      }

      await client.query('commit');
      return {
        ok: true,
        credentials: await asCredentials(this.#secret, trustExternalId<UserId>(row.user_id), prepared),
      };
    } catch (error) {
      await client.query('rollback').catch(() => {
        // The transaction may already be aborted by the error above.
      });
      if ((error as { readonly code?: string }).code === '23505') return fail();
      throw error;
    } finally {
      client.release();
    }
  }
}
