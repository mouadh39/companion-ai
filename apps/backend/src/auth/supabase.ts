import { jwtVerify } from 'jose';
import { trustExternalId, type UserId } from '@nexa/shared';
import type { AuthenticationPort, AuthResult } from './port.js';
import { authenticated, refused } from './port.js';
import { classifyJwtError } from './jwt-errors.js';

/**
 * Verifies a Supabase-issued access token.
 *
 * Supabase Auth is the provider this project already chose, before this file
 * existed: `0002_enable_rls.sql` enables row-level security with no policies
 * and says in as many words that when authentication lands, per-user policies
 * go there and match on `auth.uid()`. That is Supabase's function, and the
 * database is already a Supabase project.
 *
 * ## Verified locally, not by asking Supabase
 *
 * The obvious alternative is `supabase.auth.getUser(token)`, which costs a
 * network round trip on the path a person is waiting on — every turn, before
 * any work starts. A Supabase access token is a signed JWT, so the signature
 * can be checked here in microseconds against a secret the process already
 * holds. The round trip buys nothing this needs: it would detect a token
 * revoked mid-session slightly sooner, which matters far less than putting a
 * network dependency in front of every request.
 *
 * The cost is that a revoked token stays usable until it expires. Supabase
 * access tokens are short-lived by default, which is the mitigation, and a
 * deployment that needs immediate revocation should shorten that lifetime
 * rather than move verification onto the request path.
 *
 * ## The secret
 *
 * Read from the environment and never sent anywhere. It is the project's JWT
 * secret, which must not appear in a client build, a Unity asset, or a config
 * file that ships — a client that could sign tokens could sign one for anybody.
 */
export interface SupabaseAuthenticatorOptions {
  /** The project's JWT secret. HS256, as Supabase issues by default. */
  readonly jwtSecret: string;
  /**
   * The audience the token must name. Supabase issues `authenticated` for a
   * signed-in user; an anonymous or service token names something else and is
   * refused rather than quietly accepted.
   */
  readonly audience?: string;
  /** Tolerated clock skew in seconds. Small, and deliberately not configurable per call. */
  readonly clockToleranceSeconds?: number;
}

const DEFAULT_AUDIENCE = 'authenticated';
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 5;

export class SupabaseAuthenticator implements AuthenticationPort {
  readonly name = 'supabase';

  readonly #secret: Uint8Array;
  readonly #audience: string;
  readonly #clockTolerance: number;

  constructor(options: SupabaseAuthenticatorOptions) {
    this.#secret = new TextEncoder().encode(options.jwtSecret);
    this.#audience = options.audience ?? DEFAULT_AUDIENCE;
    this.#clockTolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  }

  async verify(credential: string | null): Promise<AuthResult> {
    if (credential === null) {
      return refused('missing', 'No bearer credential was presented.');
    }

    try {
      const { payload } = await jwtVerify(credential, this.#secret, {
        audience: this.#audience,
        clockTolerance: this.#clockTolerance,
        // Pinned. Accepting whatever the header names is how a verifier is
        // talked into `alg: none`, or into treating a public key as an HMAC
        // secret.
        algorithms: ['HS256'],
      });

      // `sub` is the account's stable id and the value that scopes memory.
      // Supabase always issues it; a token without one is not a user token.
      const subject = payload.sub;
      if (typeof subject !== 'string' || subject.trim().length === 0) {
        return refused('malformed', 'The token carries no subject.');
      }

      const expiry = payload.exp;
      if (typeof expiry !== 'number') {
        // Refused rather than treated as eternal. A credential that never
        // expires is one that cannot be taken away.
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
