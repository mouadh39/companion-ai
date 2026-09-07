import { SignJWT, jwtVerify } from 'jose';
import { trustExternalId, type UserId } from '@nexa/shared';
import type { AuthenticationPort, AuthResult } from './port.js';
import { authenticated, refused } from './port.js';
import { classifyJwtError } from './jwt-errors.js';

/**
 * Verifies a Nexa-issued device access token.
 *
 * The headset's half of the same authentication boundary phones already go
 * through — a second `AuthenticationPort` implementation, not a second
 * system. `authenticate()` and `admitForCompanion()` in `server.ts` do not
 * change at all; only what `app.auth` is composed from does, via
 * `CompositeAuthenticator`.
 *
 * ## Why this is a separate secret from Supabase's
 *
 * `NEXA_DEVICE_TOKEN_SECRET` signs and verifies tokens this backend issues
 * to itself, over an audience Supabase never names. Sharing Supabase's
 * secret would mean a leak of either compromises both, and would put this
 * backend's own token lifetime under a rotation policy it does not control.
 *
 * ## Verified locally, exactly like Supabase's tokens
 *
 * Same reasoning `SupabaseAuthenticator` already documents: a signature
 * check costs microseconds against a secret already held in memory, and
 * putting a network round trip on this path for every turn a headset makes
 * would buy detecting a revoked device slightly sooner, at a cost far
 * larger than the benefit. The tradeoff is the same one already accepted —
 * a revoked device's already-issued access token stays usable until it
 * naturally expires, at most one hour later — bounded by keeping the token
 * short-lived rather than by checking a database on every request.
 */
export const DEVICE_TOKEN_AUDIENCE = 'nexa-device';

/** One hour. Short enough that revocation's blind spot (§7 of the design) is small. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export interface DeviceTokenAuthenticatorOptions {
  /** The Nexa-owned signing secret. Never Supabase's. */
  readonly secret: string;
}

export class DeviceTokenAuthenticator implements AuthenticationPort {
  readonly name = 'nexa-device';

  readonly #secret: Uint8Array;

  constructor(options: DeviceTokenAuthenticatorOptions) {
    this.#secret = new TextEncoder().encode(options.secret);
  }

  async verify(credential: string | null): Promise<AuthResult> {
    if (credential === null) {
      return refused('missing', 'No bearer credential was presented.');
    }

    try {
      const { payload } = await jwtVerify(credential, this.#secret, {
        audience: DEVICE_TOKEN_AUDIENCE,
        // Pinned, for the same reason `SupabaseAuthenticator` pins it: a
        // verifier that accepted whatever `alg` a token named would be one
        // token payload away from `alg: none`.
        algorithms: ['HS256'],
      });

      const subject = payload.sub;
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        return refused('malformed', 'The token carries no subject.');
      }

      const expiry = payload.exp;
      if (typeof expiry !== 'number') {
        return refused('malformed', 'The token carries no expiry.');
      }

      return authenticated({
        userId: trustExternalId<UserId>(subject),
        expiresAt: expiry * 1_000,
        issuer: this.name,
      });
    } catch (error) {
      return classifyJwtError(error);
    }
  }
}

/**
 * Signs a fresh device access token for `userId`.
 *
 * The only place a device access token is minted. Called from
 * `PairingSessionStore.redeem` (initial issuance) and `DeviceTokenStore.refresh`
 * (every renewal) — never from a route directly, so there is exactly one
 * function in the codebase that decides what claims this token family
 * carries.
 */
export const signDeviceAccessToken = async (
  secret: string,
  userId: UserId,
): Promise<{ readonly token: string; readonly expiresInSeconds: number }> => {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience(DEVICE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  return { token, expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS };
};
