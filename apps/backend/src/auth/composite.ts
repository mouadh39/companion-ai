import type { AuthenticationPort, AuthResult } from './port.js';

/**
 * Tries several `AuthenticationPort`s in order and returns the first
 * success — the whole reason `authenticate()` and `admitForCompanion()` in
 * `server.ts` need no changes to accept a second kind of caller.
 *
 * A phone presents a Supabase-issued token; a headset presents a
 * Nexa-issued device token. The two are distinguished by nothing this
 * class knows about — a Supabase verifier rejects a device token
 * immediately, on signature alone, since the two are signed with different
 * secrets entirely, and a device verifier rejects a Supabase token the same
 * way. There is no shared parsing step and no peeking at either token's
 * shape to route between them; each `verify()` call is simply tried in
 * turn until one accepts.
 *
 * ## Why this is not a second authentication system
 *
 * It implements the exact same `AuthenticationPort` every other
 * authenticator does, and composes existing ones rather than deciding
 * anything about tokens itself. Nothing about verifying a Supabase token
 * changes by being tried first here instead of directly.
 */
export class CompositeAuthenticator implements AuthenticationPort {
  readonly name = 'composite';

  readonly #authenticators: readonly AuthenticationPort[];

  constructor(authenticators: readonly AuthenticationPort[]) {
    this.#authenticators = authenticators;
  }

  async verify(credential: string | null): Promise<AuthResult> {
    let last: AuthResult | null = null;

    for (const authenticator of this.#authenticators) {
      const result = await authenticator.verify(credential);
      if (result.ok) return result;
      last = result;
    }

    // Every authenticator refused. The last refusal is returned rather than
    // a merged one — inventing a combined reason would imply a caller could
    // learn something by trying again with a different credential shape,
    // which is not a distinction any response here should offer.
    return last ?? { ok: false, failure: { kind: 'missing', detail: 'No authenticators configured.' } };
  }
}
