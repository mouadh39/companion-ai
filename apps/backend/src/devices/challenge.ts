import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';

/**
 * The proof a headset makes: that it holds the private key bound to a
 * specific pairing session, over that exact session and no other.
 *
 * ## Why the session id is part of the challenge
 *
 * The secret alone already identifies the session — `code_hash` is looked up
 * by it — so binding the session id again looks redundant until the question
 * is "redundant for whom". It is redundant for the backend, which never
 * needs it to find the row. It is not redundant for the signature itself:
 * without it, a signature is a proof over the *secret*, and nothing stops
 * that same proof being replayed against a different session that happened
 * to reuse... nothing does, session ids and secrets are both unique, so in
 * practice this could not happen today. It is included anyway because a
 * verifier should not depend on an invariant it does not itself enforce —
 * the challenge is self-contained proof of *this session*, not proof of a
 * secret that today happens to name only one.
 *
 * ## The byte encoding, precisely
 *
 * Four fields, each UTF-8 encoded and prefixed with its own length as a
 * 4-byte big-endian unsigned integer, concatenated in the fixed order below,
 * then hashed once with SHA-256:
 *
 * ```
 * digest = SHA-256(
 *   len(domainTag)          ++ domainTag           ++
 *   len(pairingSessionId)   ++ pairingSessionId     ++
 *   len(secret)             ++ secret               ++
 *   len(headsetPublicKeyId) ++ headsetPublicKeyId
 * )
 * ```
 *
 * `len(x)` is `x`'s UTF-8 byte length as `UInt32BE`; `++` is byte
 * concatenation. This is deliberately not `"a" + "|" + "b"` string joining:
 * a delimiter is safe only for as long as every field's alphabet is known to
 * exclude it, which is an assumption this function has no way to enforce and
 * a future change to any field's format could silently break. A length
 * prefix makes the boundary between fields a fact about the bytes rather
 * than a fact about what today's callers happen to pass — "ab"+"c" and
 * "a"+"bc" hash to different digests under this scheme, and would not under
 * naive concatenation with no separator at all.
 *
 * Any future non-Node implementation of this protocol (the headset itself)
 * must reproduce exactly this: UTF-8 field bytes, `UInt32BE` length prefix,
 * this field order, one SHA-256 over the whole buffer.
 */
export const CHALLENGE_DOMAIN_TAG = 'nexa-pair-v2';

export interface ChallengeInput {
  /** From the resolved session row. Never accepted as a client-supplied value. */
  readonly pairingSessionId: string;
  /** The bare secret — `code` with its `NX2.` prefix already stripped. */
  readonly secret: string;
  /** From the resolved session row's `headset_public_key_id`. Never client-supplied. */
  readonly headsetPublicKeyId: string;
}

const lengthPrefixed = (value: string): Buffer => {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
};

/** Builds the exact 32-byte digest a headset must sign and a backend must verify against. */
export const buildChallenge = (input: ChallengeInput): Buffer =>
  createHash('sha256')
    .update(
      Buffer.concat([
        lengthPrefixed(CHALLENGE_DOMAIN_TAG),
        lengthPrefixed(input.pairingSessionId),
        lengthPrefixed(input.secret),
        lengthPrefixed(input.headsetPublicKeyId),
      ]),
    )
    .digest();

/**
 * The proof a headset makes on every refresh: that it still holds the same
 * private key bound to it at redemption, not merely that it holds the
 * current refresh token.
 *
 * ## Why the refresh token itself is bound into the challenge
 *
 * `refreshToken` is not there for its own sake — it is what makes this
 * challenge replay-proof with no separate nonce or nonce table. A refresh
 * token is already required to be single-use (rotated on every successful
 * refresh; see `PgDeviceTokenStore.refresh`), so a signature over a digest
 * that includes it can be valid for at most one refresh, ever: the moment
 * that refresh succeeds, the exact token value this signature was computed
 * against can never be presented again. A captured `(refreshToken,
 * signature)` pair is therefore useless after its one legitimate use, the
 * same guarantee a server-issued nonce would buy, obtained here from a
 * property the design already needed for an unrelated reason.
 *
 * Same length-prefixed, domain-separated construction as
 * {@link buildChallenge} — a different domain tag, so a signature computed
 * for one can never be mistaken for the other, and the same
 * {@link ChallengeVerdict} contract for verifying it.
 *
 * ```
 * digest = SHA-256(
 *   len(domainTag)          ++ domainTag           ++
 *   len(deviceId)            ++ deviceId             ++
 *   len(refreshToken)        ++ refreshToken          ++
 *   len(headsetPublicKeyId)  ++ headsetPublicKeyId
 * )
 * ```
 */
export const REFRESH_CHALLENGE_DOMAIN_TAG = 'nexa-refresh-v1';

export interface RefreshChallengeInput {
  /** From the resolved `device_tokens`/`devices` row. Never client-supplied. */
  readonly deviceId: string;
  /** The plaintext refresh token exactly as the headset sent it. */
  readonly refreshToken: string;
  /** From `devices.public_key_id`. Never client-supplied. */
  readonly headsetPublicKeyId: string;
}

export const buildRefreshChallenge = (input: RefreshChallengeInput): Buffer =>
  createHash('sha256')
    .update(
      Buffer.concat([
        lengthPrefixed(REFRESH_CHALLENGE_DOMAIN_TAG),
        lengthPrefixed(input.deviceId),
        lengthPrefixed(input.refreshToken),
        lengthPrefixed(input.headsetPublicKeyId),
      ]),
    )
    .digest();

export type ChallengeVerdict = 'valid' | 'invalid';

/**
 * Verifies an ECDSA signature over a challenge, against a P-256 SPKI key.
 *
 * ## The interoperability detail this exists to get right
 *
 * Android's `Signature.getInstance("SHA256withECDSA")` produces an ASN.1 DER
 * signature — 70 to 72 bytes for P-256, length not fixed because DER
 * integer encoding is. JWS/JWA — and therefore `jose`'s signature helpers —
 * expect the opposite: a fixed 64-byte raw `r‖s` concatenation. The two are
 * not interchangeable encodings of the same bytes; they are different byte
 * strings for the same mathematical signature, and passing one where the
 * other is expected fails verification of a perfectly genuine signature.
 *
 * `dsaEncoding: 'der'` is the one option that makes Node's verifier speak
 * what Android actually emits. This was measured directly against Node's own
 * `crypto` before this function was written: a real DER signature verifies
 * with this option and is rejected without it, and the reverse is true of a
 * raw `r‖s` signature — confirming the two encodings are genuinely
 * incompatible rather than one being a superset of the other.
 *
 * Returns a verdict rather than throwing. A structurally malformed key or
 * signature and a cryptographically wrong one are both "this proof does not
 * hold" to every caller of this function — collapsing them here means no
 * caller can accidentally treat a malformed-input exception differently from
 * an invalid-signature result, which is exactly the distinction that must
 * never reach a response.
 */
export const verifyChallenge = (spkiDer: Buffer, challenge: Buffer, signatureDer: Buffer): ChallengeVerdict => {
  try {
    const key = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
    const ok = verifySignature('sha256', challenge, { key, dsaEncoding: 'der' }, signatureDer);
    return ok ? 'valid' : 'invalid';
  } catch {
    // Node/OpenSSL throws for some malformed inputs (a garbage key, a
    // structurally invalid DER signature) rather than returning false for
    // them. Treated identically to a cryptographically wrong signature.
    return 'invalid';
  }
};
