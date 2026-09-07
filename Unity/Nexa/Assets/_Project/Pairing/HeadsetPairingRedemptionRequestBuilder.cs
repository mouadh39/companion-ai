using System;
using Nexa.Core.Identity;

namespace Nexa.Pairing
{
    /// <summary>
    /// Turns a validated pairing code, a known pairing-session id, and this headset's own
    /// cryptographic identity into a ready-to-send <see cref="PairingRedemptionRequest"/> —
    /// the point where <see cref="IHeadsetIdentity"/> first enters the pairing flow.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is proof of possession, prepared. It is deliberately NOT authentication having
    /// happened: scanning a QR code and building a signature over it proves this headset holds
    /// the private key it claims to — nothing here marks anything paired, stores a credential, or
    /// tells any other part of this app "the headset is now trusted." The backend alone decides
    /// that, by verifying the signature this method produces against the public key it already
    /// has on file (see <c>verifyChallenge</c> in <c>apps/backend/src/devices/challenge.ts</c>)
    /// and returning device tokens only if it holds. A caller of this method still has to send
    /// the result to the backend and get back a successful <c>{ paired: true, ... }</c> response
    /// before treating this headset as authenticated — that HTTP call is deliberately not made by
    /// this method, or anywhere else in this step; see the report on why it stays deferred.
    /// </para>
    /// <para>
    /// ## Why <paramref name="pairingSessionId"/> is a parameter, not resolved here
    /// </para>
    /// <para>
    /// The QR code a headset scans carries exactly <c>NX2.&lt;secret&gt;</c> and nothing else
    /// (see <c>PairingCodeValidator</c>'s own doc) — no session id. The backend's own redeem
    /// route (<c>POST /v1/pairing-sessions/redeem</c>) does not accept one either: it resolves
    /// <c>pairingSessionId</c> itself, server-side, from the session the code's hash names, and
    /// builds its verification challenge from that resolved value. For a headset's signature to
    /// verify, it must be built from the SAME <c>pairingSessionId</c> the backend will resolve —
    /// which means the headset has to learn it some other way before calling this method. The
    /// only channel that fits is the local connection between phone and headset established
    /// during discovery (LAN transport, deferred to a later step): the phone already knows
    /// <c>pairingSessionId</c> from creating the session, and can hand it to the headset over that
    /// channel as pairing context, separately from the QR's out-of-band secret. This method takes
    /// that value as a given, already-resolved input — the same way it takes an already-validated
    /// code, rather than resolving either itself.
    /// </para>
    /// <para>
    /// Only <see cref="IHeadsetIdentity.Sign"/> is used here — never anything that would touch
    /// private key bytes, which <see cref="IHeadsetIdentity"/> never exposes in the first place.
    /// <see cref="IHeadsetIdentity.PublicKeyId"/> is read to build the challenge, matching what
    /// the backend already has on file for this key from enrolment — this method does not verify
    /// that the two agree; a mismatch simply yields a request the backend's own verification will
    /// reject, the same as any other wrong proof.
    /// </para>
    /// </remarks>
    public static class HeadsetPairingRedemptionRequestBuilder
    {
        /// <summary>
        /// Builds a signed redemption request. Does not call the network, does not read or write
        /// <see cref="PendingPairingCode"/>, and does not check <see cref="IHeadsetIdentity.HasKey"/>
        /// before signing — an identity with no key raises <c>HeadsetIdentityException</c> from
        /// <see cref="IHeadsetIdentity.Sign"/> itself, which this method deliberately lets
        /// propagate rather than wrapping.
        /// </summary>
        /// <param name="identity">This headset's cryptographic identity. Must already have a key
        /// (see <see cref="IHeadsetIdentity.EnsureKey"/>) — ordinarily true well before pairing,
        /// since the same key must already be on file with the backend from enrolment for any
        /// redemption to ever succeed.</param>
        /// <param name="pairingSessionId">
        /// The session id this proof is bound to — see the class doc on why this cannot come from
        /// the QR code itself and must be supplied by the caller.
        /// </param>
        /// <param name="validatedNx2Code">
        /// A code that has already passed <see cref="PairingCodeValidator.Validate"/> — typically
        /// straight from <see cref="PendingPairingCode.Take"/>. This method re-derives the bare
        /// secret from it (stripping the <c>NX2.</c> prefix, the same request-shape concern the
        /// backend's own route documents performing itself) but does not re-run full NX2
        /// validation — the caller is responsible for that, the same division of responsibility
        /// <see cref="PendingPairingCode.Set"/> already documents.
        /// </param>
        /// <exception cref="ArgumentNullException"><paramref name="identity"/> is null.</exception>
        /// <exception cref="ArgumentException">
        /// <paramref name="pairingSessionId"/> is null or empty, or <paramref name="validatedNx2Code"/>
        /// is null, empty, or does not start with the <c>NX2.</c> prefix.
        /// </exception>
        public static PairingRedemptionRequest Build(
            IHeadsetIdentity identity,
            string pairingSessionId,
            string validatedNx2Code)
        {
            if (identity == null) throw new ArgumentNullException(nameof(identity));

            if (string.IsNullOrEmpty(pairingSessionId))
                throw new ArgumentException("A pairing session id is required.", nameof(pairingSessionId));

            if (string.IsNullOrEmpty(validatedNx2Code) ||
                !validatedNx2Code.StartsWith(PairingCodeValidator.Prefix, StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Must be a code already accepted by PairingCodeValidator.Validate.",
                    nameof(validatedNx2Code));
            }

            string secret = validatedNx2Code.Substring(PairingCodeValidator.Prefix.Length);
            string headsetPublicKeyId = identity.PublicKeyId;

            byte[] challenge = PairingChallenge.Build(pairingSessionId, secret, headsetPublicKeyId);
            byte[] signature = identity.Sign(challenge);

            return PairingRedemptionRequest.Create(validatedNx2Code, signature);
        }
    }
}
