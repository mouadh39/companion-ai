import { errors } from 'jose';
import type { AuthResult } from './port.js';
import { refused } from './port.js';

/**
 * Maps a `jose` verification error onto the closed `AuthFailureKind`
 * vocabulary, shared by every JWT-based authenticator this backend has.
 *
 * Extracted from `SupabaseAuthenticator`, which held this logic alone until
 * `DeviceTokenAuthenticator` needed the identical mapping for a different
 * secret and a different audience. Two independently-written copies of the
 * same seven `instanceof` checks is exactly the kind of drift a shared
 * function exists to prevent — the same reasoning `secrets.ts` already
 * applies to hashing a handle versus hashing a pairing code.
 *
 * The detail is kept for the server log and never returned: telling a
 * caller precisely why their token failed tells an attacker what to change.
 */
export const classifyJwtError = (error: unknown): AuthResult => {
  const detail = error instanceof Error ? error.message : String(error);

  if (error instanceof errors.JWTExpired) return refused('expired', detail);
  if (error instanceof errors.JWTClaimValidationFailed) {
    return refused(error.claim === 'aud' ? 'wrong_audience' : 'malformed', detail);
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return refused('invalid_signature', detail);
  }
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    return refused('malformed', detail);
  }

  return refused('malformed', detail);
};
