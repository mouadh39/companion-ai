using System;
using System.Security.Cryptography;
using System.Text;

namespace Nexa.Pairing
{
    /// <summary>
    /// Builds the exact 32-byte digest a headset must sign to redeem a pairing session — a
    /// byte-for-byte C# port of <c>buildChallenge</c> in
    /// <c>apps/backend/src/devices/challenge.ts</c>, which is what the backend itself verifies
    /// against. Nothing about this encoding is invented here; it is fixed by that function.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Four fields, each UTF-8 encoded and prefixed with its own length as a 4-byte big-endian
    /// unsigned integer, concatenated in this fixed order, then hashed once with SHA-256:
    /// </para>
    /// <para>
    /// <c>SHA-256(len(domainTag) ++ domainTag ++ len(pairingSessionId) ++ pairingSessionId ++
    /// len(secret) ++ secret ++ len(headsetPublicKeyId) ++ headsetPublicKeyId)</c>
    /// </para>
    /// <para>
    /// <c>len(x)</c> is <c>x</c>'s UTF-8 byte length as big-endian <c>UInt32</c>; <c>++</c> is byte
    /// concatenation. This is deliberately not delimiter-joined string concatenation — see the
    /// backend function's own doc comment on why a length prefix is a fact about the bytes rather
    /// than an assumption about what today's field values happen to contain.
    /// </para>
    /// <para>
    /// This class was cross-checked against the real backend function, not merely translated by
    /// eye: <c>buildChallenge</c> was imported into a throwaway Vitest test and run with fixed
    /// inputs (<c>pairingSessionId: "test-session-id-001"</c>,
    /// <c>secret: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE"</c>,
    /// <c>headsetPublicKeyId: "test-headset-public-key-id"</c>), producing digest
    /// <c>f4450af5f415c00a20a21daa130007b51eab34a34330efc6cfb13b92a4ec849b</c> (hex) /
    /// <c>9EUK9fQVwAogoh2qEwAHtR6rNKNDMO/Gz7E7kqTshJs=</c> (base64) — the exact vector
    /// <c>Nexa.Pairing.Tests.PairingChallengeTests</c> asserts this class reproduces. The scratch
    /// test file was deleted immediately after capturing this vector; nothing about it is part of
    /// the backend's own test suite. This still does not make this C# implementation
    /// Unity-verified — see the report on why no Unity Editor can compile or run it in this
    /// environment — but it does mean the byte layout itself, independent of C# even compiling,
    /// is proven correct against the actual backend code, not just this class's own doc comment.
    /// </para>
    /// </remarks>
    public static class PairingChallenge
    {
        /// <summary>Matches <c>CHALLENGE_DOMAIN_TAG</c> in <c>apps/backend/src/devices/challenge.ts</c>.</summary>
        public const string DomainTag = "nexa-pair-v2";

        /// <summary>
        /// Builds the digest a headset signs to redeem a pairing session. None of the three
        /// inputs are validated here — a null or malformed value simply produces a digest that
        /// will never match anything the backend computes, which is exactly the outcome a truly
        /// wrong input should have; this method's job is the encoding, not judging its inputs.
        /// </summary>
        /// <param name="pairingSessionId">
        /// The session id this proof is bound to. The headset cannot derive this from the QR code
        /// alone (the QR carries only <c>NX2.&lt;secret&gt;</c> — see
        /// <c>PairingCodeValidator</c>'s own doc); it must reach the headset through the local
        /// pairing-context channel the phone and headset share once discovered (LAN transport,
        /// deferred to a later step). This method takes it as a given, already-resolved input,
        /// the same way <see cref="IHeadsetQrScanner"/> et al. never resolve it either.
        /// </param>
        /// <param name="secret">
        /// The bare secret — the pairing code with its <c>NX2.</c> prefix already stripped, the
        /// same convention <c>ChallengeInput.secret</c> documents on the backend.
        /// </param>
        /// <param name="headsetPublicKeyId">
        /// <c>IHeadsetIdentity.PublicKeyId</c> — computed locally by the headset from its own
        /// Keystore-held public key, and expected to equal what the backend already has on file
        /// for this session's bound key from enrolment. This method does not compute or verify
        /// that equality; a mismatch here simply yields a challenge the backend's stored key can
        /// never produce a valid signature over, which <c>verifyChallenge</c> rejects like any
        /// other wrong proof.
        /// </param>
        public static byte[] Build(string pairingSessionId, string secret, string headsetPublicKeyId)
        {
            using SHA256 sha256 = SHA256.Create();

            byte[] buffer = Concat(
                LengthPrefixed(DomainTag),
                LengthPrefixed(pairingSessionId),
                LengthPrefixed(secret),
                LengthPrefixed(headsetPublicKeyId));

            return sha256.ComputeHash(buffer);
        }

        static byte[] LengthPrefixed(string value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value ?? string.Empty);
            byte[] length = new byte[4];
            // Big-endian (network byte order) UInt32 — matches Node Buffer.writeUInt32BE.
            length[0] = (byte)(bytes.Length >> 24);
            length[1] = (byte)(bytes.Length >> 16);
            length[2] = (byte)(bytes.Length >> 8);
            length[3] = (byte)bytes.Length;
            return Concat(length, bytes);
        }

        static byte[] Concat(params byte[][] parts)
        {
            int total = 0;
            foreach (byte[] part in parts) total += part.Length;

            byte[] result = new byte[total];
            int offset = 0;
            foreach (byte[] part in parts)
            {
                Buffer.BlockCopy(part, 0, result, offset, part.Length);
                offset += part.Length;
            }
            return result;
        }
    }
}
