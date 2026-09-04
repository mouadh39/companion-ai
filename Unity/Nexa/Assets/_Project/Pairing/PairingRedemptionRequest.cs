using System;

namespace Nexa.Pairing
{
    /// <summary>
    /// Exactly what <c>POST /v1/pairing-sessions/redeem</c> needs in its request body — a
    /// pairing code and a signature over the challenge it implies — already assembled, never yet
    /// sent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Matches the backend route's own documented request shape exactly (see
    /// <c>apps/backend/src/server.ts</c>'s <c>/v1/pairing-sessions/redeem</c> handler): two
    /// fields, <c>code</c> and <c>signature</c> (base64), and nothing else — no
    /// <c>publicKeyId</c>, no <c>userId</c>, no <c>pairingSessionId</c>. The backend resolves all
    /// three of those itself from the session the code's hash names; a request body that
    /// contained them would be ignored even if this type offered them.
    /// </para>
    /// <para>
    /// Building one of these is not the same as pairing having happened — see
    /// <see cref="HeadsetPairingRedemptionRequestBuilder"/>'s own doc. This type carries a request
    /// ready to send, nothing more; no HTTP call happens here, and the backend remains the sole
    /// authority on whether the signature it carries actually verifies.
    /// </para>
    /// </remarks>
    public readonly struct PairingRedemptionRequest
    {
        PairingRedemptionRequest(string code, byte[] signatureDer)
        {
            Code = code;
            SignatureDer = signatureDer;
        }

        internal static PairingRedemptionRequest Create(string code, byte[] signatureDer) =>
            new PairingRedemptionRequest(code, signatureDer);

        /// <summary>The exact <c>NX2.&lt;secret&gt;</c> string this request is redeeming.</summary>
        public string Code { get; }

        /// <summary>
        /// The raw ASN.1 DER-encoded ECDSA signature bytes — exactly what
        /// <c>IHeadsetIdentity.Sign</c> returned, and exactly the encoding
        /// <c>verifyChallenge</c> on the backend expects (<c>dsaEncoding: 'der'</c>).
        /// </summary>
        public byte[] SignatureDer { get; }

        /// <summary>
        /// <see cref="SignatureDer"/>, base64-encoded — the exact transport encoding the redeem
        /// route's <c>signature</c> field expects.
        /// </summary>
        public string SignatureBase64 => Convert.ToBase64String(SignatureDer);

        /// <summary>
        /// Deliberately never includes <see cref="Code"/> or any signature bytes — a pairing code
        /// is exactly as sensitive here as everywhere else in this codebase (see
        /// <see cref="PendingPairingCode"/>'s own doc), and a signature, while not secret in the
        /// same way, has no reason to appear in a log either.
        /// </summary>
        public override string ToString() =>
            $"PairingRedemptionRequest(hasCode: {Code != null}, signatureLength: {SignatureDer?.Length ?? 0})";
    }
}
