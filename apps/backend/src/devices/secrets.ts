import { createHash, randomBytes } from 'node:crypto';

/**
 * The one way this codebase mints and hashes a single-use secret.
 *
 * Both an enrolment handle and a pairing code are the same shape of thing —
 * 256 bits of CSPRNG output, base64url-encoded, returned to a caller exactly
 * once and stored only as its SHA-256 — so they are generated and hashed by
 * the same two functions rather than two independently written copies of the
 * same three lines. Two copies are how a hash mismatch becomes possible: one
 * definition cannot drift from itself.
 */

/** 256 bits, base64url, unpadded — 43 characters. */
export const randomSecret = (): string => randomBytes(32).toString('base64url');

/** SHA-256 of a secret, base64url. What is safe to store. */
export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('base64url');
