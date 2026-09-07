import type { UserId } from '@nexa/shared';

/**
 * The authentication boundary.
 *
 * Declared here rather than in `@nexa/core` on purpose. Core's ports are the
 * faculties a *turn* depends on; who is asking is a transport concern that is
 * settled before a turn exists. A `AuthenticationPort` in Core would make the
 * cognitive pipeline aware of bearer tokens, which is the same category error
 * as making it aware of HTTP.
 *
 * A port all the same, with adapters, because which provider issues the token
 * is a deployment decision — the same reason `LanguageModelPort` exists. It is
 * also what lets the whole suite run offline: the real Supabase verifier is
 * exercised against locally signed tokens, and nothing reaches the network.
 */

/**
 * Who the caller actually is, once proved.
 *
 * The only source of a `UserId` that anything is allowed to trust. Every other
 * user identifier in a request is a claim the caller made about itself.
 *
 * Deliberately minimal. It carries identity, not profile: a display name or a
 * locale read from a token would be a second, staler copy of what the `users`
 * table owns, and the two would disagree the first time someone changed one.
 */
export interface AuthenticatedIdentity {
  /**
   * The account's stable identifier, as the provider issued it.
   *
   * This is the value that scopes memory. It is never read from a request body.
   */
  readonly userId: UserId;
  /** When the presented credential expires, as epoch milliseconds. */
  readonly expiresAt: number;
  /** Which adapter proved it. Recorded so a failure can be traced to a provider. */
  readonly issuer: string;
}

/**
 * Why a credential was refused.
 *
 * A closed set rather than a message, because the HTTP layer maps these onto
 * status codes and a caller deserves to know whether to re-authenticate or give
 * up. The *detail* stays out of the response: telling an attacker precisely why
 * a token failed is telling them how to fix it.
 */
export type AuthFailureKind =
  /** No credential was presented at all. */
  | 'missing'
  /** Present but not a readable token. */
  | 'malformed'
  /** Readable, but the signature does not verify. */
  | 'invalid_signature'
  /** Verified, but past its expiry. */
  | 'expired'
  /** Verified and current, but issued for something other than this system. */
  | 'wrong_audience'
  /** The verifier itself could not run — misconfiguration, not a bad caller. */
  | 'unavailable';

export interface AuthFailure {
  readonly kind: AuthFailureKind;
  /** For the server log. Never returned to the caller. */
  readonly detail: string;
}

/**
 * Proves who a caller is, or refuses.
 *
 * Returns a `Result` rather than throwing: a bad credential is an ordinary,
 * expected outcome on a public endpoint, and an exception would make the
 * common case the exceptional path.
 *
 * **There is no method here that accepts an identity.** Nothing in this system
 * may assert who the caller is; identity is only ever proved.
 */
export interface AuthenticationPort {
  readonly name: string;
  verify(credential: string | null): Promise<AuthResult>;
}

export type AuthResult =
  | { readonly ok: true; readonly identity: AuthenticatedIdentity }
  | { readonly ok: false; readonly failure: AuthFailure };

export const authenticated = (identity: AuthenticatedIdentity): AuthResult => ({
  ok: true,
  identity,
});

export const refused = (kind: AuthFailureKind, detail: string): AuthResult => ({
  ok: false,
  failure: { kind, detail },
});

/**
 * Reads a bearer credential out of an Authorization header.
 *
 * Returns null for anything that is not a well-formed `Bearer <token>`, which
 * the verifier then refuses as `missing`. Parsing here rather than in each
 * adapter keeps the header format in one place, and keeps an adapter from
 * accidentally accepting a raw token in a header that says `Basic`.
 */
export const bearerToken = (header: string | undefined): string | null => {
  if (header === undefined) return null;

  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;

  const token = rest.join(' ').trim();
  return token.length === 0 ? null : token;
};
