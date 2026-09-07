import { createHash, createPublicKey } from 'node:crypto';

/**
 * Parsing and validating a headset's public key.
 *
 * ## What this proves and what it does not
 *
 * A key that parses here is a syntactically valid EC P-256 public key —
 * nothing more. It proves nothing about who submitted it or whether they hold
 * the matching private key. That proof is a signature over a later challenge,
 * checked at pairing redemption, which does not exist yet. Enrolment is a
 * publication, not an authentication, and this is only the check that what
 * was published is the kind of thing the protocol expects.
 */

/**
 * Whether a string is safe to decode as standard base64.
 *
 * `Buffer.from(str, 'base64')` does not throw on nonsense — it decodes
 * whatever it can and silently drops the rest, which would let malformed
 * input pass as a truncated or empty value instead of being refused as what
 * it actually is. Checked before decoding, not after.
 *
 * Exported because it is not specific to a public key — a signature is the
 * same kind of base64-encoded binary field, and deserves the same rigor
 * rather than a second, independently-written check.
 */
export const isPlausibleBase64 = (value: string): boolean =>
  value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);

export type SpkiFailureReason = 'malformed_base64' | 'malformed_der' | 'not_ec' | 'wrong_curve';

export type SpkiValidation =
  | { readonly ok: true; readonly der: Buffer; readonly keyId: string }
  | { readonly ok: false; readonly reason: SpkiFailureReason };

/**
 * Parses a base64-encoded X.509 SubjectPublicKeyInfo and confirms it is an EC
 * P-256 key, or reports precisely why it is not.
 *
 * `keyId` is derived here — base64url SHA-256 of the exact DER bytes — rather
 * than accepted from a caller. A self-asserted identifier for a key is a
 * claim; the key itself already determines one that cannot be spoofed, so
 * accepting a client-supplied alternative would only invite a mismatch
 * between what a fingerprint says and what the key actually is.
 */
export const parseP256Spki = (base64: string): SpkiValidation => {
  if (!isPlausibleBase64(base64)) return { ok: false, reason: 'malformed_base64' };

  const der = Buffer.from(base64, 'base64');

  let key;
  try {
    key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    return { ok: false, reason: 'malformed_der' };
  }

  if (key.asymmetricKeyType !== 'ec') return { ok: false, reason: 'not_ec' };

  // Node/OpenSSL's name for the curve NIST calls P-256 and SEC 2 calls
  // secp256r1. Checked by name, not by key or DER length: several curves
  // this protocol does not accept share P-256's encoded size, so a length
  // check alone would let the wrong curve through.
  if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    return { ok: false, reason: 'wrong_curve' };
  }

  const keyId = createHash('sha256').update(der).digest('base64url');
  return { ok: true, der, keyId };
};
