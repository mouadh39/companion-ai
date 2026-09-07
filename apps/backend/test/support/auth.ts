import { SignJWT } from 'jose';
import type { CompanionId, UserId } from '@nexa/shared';
import { InMemoryCompanionBindings } from '../../dist/auth/bindings.js';

/**
 * Authenticating the existing suites.
 *
 * Every backend test predates authentication and posted its identifiers in the
 * body. Those requests are now refused, which is the point — so rather than
 * bypassing the boundary for tests, they authenticate through it exactly as a
 * real client does.
 *
 * The tokens are real: signed here, verified by the production
 * `SupabaseAuthenticator`. Nothing is stubbed and nothing reaches the network.
 */

/** Only ever used by tests. Not a secret from any real project. */
export const TEST_JWT_SECRET = 'test-secret-not-used-anywhere-real-0123456789abcdef';

/** Mints a credential the real verifier accepts, exactly as Supabase would. */
export const mintToken = async (subject: string): Promise<string> =>
  new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));

/** The Authorization header for a subject. */
export const authHeaders = async (
  subject: string,
): Promise<{ readonly authorization: string }> => ({
  authorization: `Bearer ${await mintToken(subject)}`,
});

/**
 * A binding store with these accounts bound to this companion.
 *
 * Explicit rather than permissive: a store that allowed everything would let a
 * test pass while the guard was broken.
 */
export const bindingsFor = (
  companionId: CompanionId,
  users: readonly UserId[],
): InMemoryCompanionBindings => {
  const bindings = new InMemoryCompanionBindings();
  for (const user of users) bindings.bind(user, companionId);
  return bindings;
};
