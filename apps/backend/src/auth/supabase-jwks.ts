import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from 'jose';
import { trustExternalId, type UserId } from '@nexa/shared';
import type { AuthenticationPort, AuthResult } from './port.js';
import { authenticated, refused } from './port.js';
import { classifyJwtError } from './jwt-errors.js';

/**
 * Verifies a Supabase access token signed with the project's **asymmetric**
 * key (ES256 / RS256), against the public keys the project publishes at
 * `/auth/v1/.well-known/jwks.json`.
 *
 * ## Why this exists alongside `SupabaseAuthenticator`
 *
 * `SupabaseAuthenticator` verifies the legacy shared-secret (HS256) tokens.
 * A project migrated to — or created with — asymmetric JWT signing has no
 * shared secret to hand this backend; it publishes a rotating public key set
 * instead. `nexa-dev` is one such project. The verification contract is
 * otherwise identical: check the signature, the audience, `sub` and `exp`,
 * verify locally, and never trust anything from the request body.
 *
 * The composition root picks this one when `SUPABASE_URL` is configured, and
 * falls back to the HS256 verifier when only `SUPABASE_JWT_SECRET` is —
 * neither is ever both, and a project that uses neither still gets
 * `DenyAllAuthenticator`.
 *
 * ## Verified locally, keys fetched once and cached
 *
 * `createRemoteJWKSet` fetches the key set on first use and caches it, with a
 * cooldown before it will re-fetch on an unknown `kid` (a key rotation). No
 * per-request network call — the token's signature is checked in process
 * against a cached key, exactly as the HS256 path checks it against a cached
 * secret. The one network dependency is the first verification after a
 * restart, and a key rotation; both are rare and both are Supabase's own
 * published, cacheable endpoint.
 */
export interface SupabaseJwksAuthenticatorOptions {
  /**
   * The project's JWKS endpoint, e.g.
   * `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`. Ignored when
   * {@link keySet} is supplied (tests pass a local key set so nothing
   * reaches the network).
   */
  readonly jwksUrl?: URL;
  /**
   * A pre-built key resolver — `createLocalJWKSet(...)` in tests. Exactly the
   * seam `SupabaseAuthenticator` does not need because an HS256 secret is
   * already local.
   */
  readonly keySet?: JWTVerifyGetKey;
  /** The audience the token must name. Supabase issues `authenticated`. */
  readonly audience?: string;
  /** Tolerated clock skew in seconds. Small, deliberately not per-call. */
  readonly clockToleranceSeconds?: number;
}

const DEFAULT_AUDIENCE = 'authenticated';
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

// Supabase signs asymmetric access tokens with an EC (ES256) or RSA (RS256)
// key. Pinned so a token header naming anything else — `none`, or `HS256`
// with a public key smuggled in as the "secret" — is refused rather than
// verified.
const ALGORITHMS = ['ES256', 'RS256'] as const;

export class SupabaseJwksAuthenticator implements AuthenticationPort {
  readonly name = 'supabase-jwks';

  readonly #keySet: JWTVerifyGetKey;
  readonly #audience: string;
  readonly #clockTolerance: number;

  constructor(options: SupabaseJwksAuthenticatorOptions) {
    if (options.keySet !== undefined) {
      this.#keySet = options.keySet;
    } else if (options.jwksUrl !== undefined) {
      this.#keySet = createRemoteJWKSet(options.jwksUrl);
    } else {
      throw new Error('SupabaseJwksAuthenticator needs either a jwksUrl or a keySet.');
    }
    this.#audience = options.audience ?? DEFAULT_AUDIENCE;
    this.#clockTolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  }

  async verify(credential: string | null): Promise<AuthResult> {
    if (credential === null) {
      return refused('missing', 'No bearer credential was presented.');
    }

    try {
      const { payload } = await jwtVerify(credential, this.#keySet, {
        audience: this.#audience,
        clockTolerance: this.#clockTolerance,
        algorithms: [...ALGORITHMS],
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
