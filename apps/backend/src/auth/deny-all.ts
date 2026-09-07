import type { AuthenticationPort, AuthResult } from './port.js';
import { refused } from './port.js';

/**
 * Refuses everything.
 *
 * What a deployment gets when no authentication is configured, and the reason
 * a missing secret is safe rather than catastrophic. The alternative — falling
 * back to the identifiers in the request body — is exactly the hole this whole
 * step exists to close, and it would reappear the first time someone forgot an
 * environment variable.
 *
 * So the failure mode is a server that answers 401 to everything and says why
 * in its logs. That is loud, immediate, and impossible to mistake for working.
 */
export class DenyAllAuthenticator implements AuthenticationPort {
  readonly name = 'deny-all';

  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  async verify(): Promise<AuthResult> {
    // `unavailable` rather than `missing`: this is a misconfigured server, not
    // a caller who forgot a header, and the two deserve different status codes.
    return refused('unavailable', this.#reason);
  }
}
