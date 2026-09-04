using System;

namespace Nexa.Core.Pairing
{
    /// <summary>How a redemption attempt settled — see <see cref="PairingRedemptionOutcome"/>'s own doc for what each value means for retrying.</summary>
    public enum PairingRedemptionOutcomeKind
    {
        /// <summary>
        /// The backend verified the signature and returned genuine device credentials. The only
        /// value <see cref="PairingRedemptionOutcome.Credentials"/> is meaningful for.
        /// </summary>
        Succeeded,

        /// <summary>
        /// The backend explicitly refused this attempt (a 4xx response it actually sent and this
        /// client actually read) — a wrong signature, an expired or already-redeemed code, or a
        /// malformed request. Never safe to retry with the same signature: if the code was already
        /// consumed by this same attempt succeeding once already, a retry would only confirm that,
        /// never recover the credentials that first success returned.
        /// </summary>
        Rejected,

        /// <summary>
        /// The backend answered 429 — too many attempts from this source. Distinct from
        /// <see cref="Rejected"/> specifically because no redemption attempt was actually processed;
        /// a caller MAY back off and retry the same signature later, which is not true of any other
        /// non-success outcome.
        /// </summary>
        RateLimited,

        /// <summary>
        /// This client could not learn what happened: a network failure, a timeout, or a 5xx
        /// response. Critically, this does NOT mean the attempt failed — the backend may have
        /// already verified the signature and redeemed the session before the failure occurred on
        /// this side of the wire, in which case the credentials that redemption produced are already
        /// gone (the backend returns them exactly once — see
        /// <c>apps/backend/src/server.ts</c>'s own doc on <c>POST /v1/pairing-sessions/redeem</c>)
        /// and cannot be recovered by asking again. See <see cref="IHeadsetPairingRedemptionClient"/>'s
        /// own doc for why this class does not decide what to do about that on a caller's behalf.
        /// </summary>
        Unreachable,

        /// <summary>
        /// A response arrived with a success-shaped status but a body this client could not read,
        /// or one missing a field a genuine success response always has. Never treated as success —
        /// see <see cref="PairingRedemptionOutcome.Succeeded"/>'s own doc.
        /// </summary>
        Malformed,
    }

    /// <summary>
    /// The result of one redemption attempt — never more than a safe, generic description of what
    /// happened, and never anything from the request itself echoed back.
    /// </summary>
    public readonly struct PairingRedemptionOutcome
    {
        PairingRedemptionOutcome(PairingRedemptionOutcomeKind kind, DeviceCredentials? credentials, string message)
        {
            Kind = kind;
            Credentials = credentials;
            Message = message;
        }

        /// <summary>
        /// Builds a <see cref="PairingRedemptionOutcomeKind.Succeeded"/> outcome. The only
        /// constructor that ever attaches <see cref="Credentials"/> — every other outcome carries
        /// <c>null</c>, so a caller cannot accidentally read credentials off a failed attempt.
        /// </summary>
        public static PairingRedemptionOutcome Succeeded(DeviceCredentials credentials) =>
            new PairingRedemptionOutcome(PairingRedemptionOutcomeKind.Succeeded, credentials, "Paired.");

        public static PairingRedemptionOutcome Rejected(string message) =>
            new PairingRedemptionOutcome(PairingRedemptionOutcomeKind.Rejected, null, message);

        public static PairingRedemptionOutcome RateLimited(string message) =>
            new PairingRedemptionOutcome(PairingRedemptionOutcomeKind.RateLimited, null, message);

        public static PairingRedemptionOutcome Unreachable(string message) =>
            new PairingRedemptionOutcome(PairingRedemptionOutcomeKind.Unreachable, null, message);

        public static PairingRedemptionOutcome Malformed(string message) =>
            new PairingRedemptionOutcome(PairingRedemptionOutcomeKind.Malformed, null, message);

        public PairingRedemptionOutcomeKind Kind { get; }

        /// <summary>The credentials a successful redemption returned. Meaningful only when <see cref="Kind"/> is <see cref="PairingRedemptionOutcomeKind.Succeeded"/>.</summary>
        public DeviceCredentials? Credentials { get; }

        /// <summary>
        /// A safe, user-presentable description of what happened — never a raw backend stack trace,
        /// never the request's own code or signature. For a rejection, this is either the backend's
        /// own already-generic message (see <c>apps/backend/src/server.ts</c>'s own doc on why its
        /// redeem responses are deliberately uninformative) or a fixed fallback this client supplies.
        /// </summary>
        public string Message { get; }

        /// <summary>Deliberately never includes <see cref="Credentials"/>'s own tokens.</summary>
        public override string ToString() =>
            $"PairingRedemptionOutcome(kind: {Kind}, message: {Message})";
    }

    /// <summary>
    /// Sends a headset's redemption request to the backend and reports what happened — the one and
    /// only place <c>POST /v1/pairing-sessions/redeem</c> is called from.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Declared in <c>Nexa.Core</c>, which references no transport, matching
    /// <c>ICompanionBackend</c>'s own precedent exactly: the redemption call can be made over
    /// <c>UnityWebRequest</c> today and over anything else later without
    /// <c>HeadsetPairingCoordinator</c> — the one consumer of this interface — changing at all.
    /// Callback-based for the same reason <c>ICompanionBackend.Send</c> is: whatever the concrete
    /// transport is, delivering the result on the correct thread is that implementation's job, not
    /// this interface's.
    /// </para>
    /// <para>
    /// Takes <paramref name="code"/> and <paramref name="signatureBase64"/> directly — the two
    /// fields, and only the two fields, <c>POST /v1/pairing-sessions/redeem</c>'s request body has —
    /// rather than a <c>PairingRedemptionRequest</c>, so this Core-level interface never needs to
    /// reference that concrete, <c>Nexa.Pairing</c>-only wire-shape type. Nothing about a private
    /// key, a challenge, or a headset identity crosses this boundary; by the time a caller reaches
    /// this interface, all of that has already happened.
    /// </para>
    /// <para>
    /// ## Why this interface does not retry
    /// </para>
    /// <para>
    /// A pairing code is single-use by the backend's own design — see
    /// <c>PairingSessionStore.redeem</c>'s own doc. An implementation of this interface makes
    /// exactly one HTTP attempt per call and reports exactly one <see cref="PairingRedemptionOutcome"/>;
    /// it never retries on a timeout, a connection failure, or a 5xx response on its own initiative.
    /// The reason is not caution for its own sake: a retry after a genuine timeout cannot tell
    /// "the request never reached the backend" apart from "the backend redeemed the session and the
    /// response was lost on the way back" — and in the second case, retrying with the same signature
    /// only ever reproduces the backend's own single-use refusal, while the credentials that first,
    /// invisible success already returned are gone for good. Deciding what to do about that
    /// (surface it to a person, start an entirely new pairing attempt) belongs one layer up, with
    /// whatever has enough context to make it — never inside this call.
    /// </para>
    /// </remarks>
    public interface IHeadsetPairingRedemptionClient
    {
        /// <summary>
        /// Makes exactly one redemption attempt. <paramref name="onResult"/> is invoked exactly
        /// once, with the outcome.
        /// </summary>
        void Redeem(string code, string signatureBase64, Action<PairingRedemptionOutcome> onResult);
    }
}
