using System;
using Nexa.Core.Pairing;
using UnityEngine;

namespace Nexa.Pairing
{
    /// <summary>
    /// Turns a raw HTTP outcome — a transport-level result, a status code, a response body — into a
    /// <see cref="PairingRedemptionOutcome"/>, against the real backend contract:
    /// <c>POST /v1/pairing-sessions/redeem</c> in <c>apps/backend/src/server.ts</c>. Nothing here
    /// touches <see cref="UnityEngine.Networking.UnityWebRequest"/> directly — every method takes
    /// plain primitives, which is what makes this class testable in EditMode with no network, no
    /// coroutine, and no Unity Editor player at all.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ## The contract this class was written against, precisely
    /// </para>
    /// <para>
    /// A successful redemption is exactly <c>{ paired: true, deviceId, accessToken, refreshToken,
    /// expiresIn }</c>, HTTP 200 — read directly from <c>server.ts</c>'s own redeem handler, never
    /// guessed. Every failure the backend can send for this route is <c>{ error, message }</c>: 429
    /// for <c>rate_limited</c>, 400 for <c>invalid_request</c> (malformed request shape, or a wrong
    /// signature, an expired session, or an already-redeemed code — the backend deliberately
    /// collapses all of the latter into the identical message; see
    /// <c>PairingSessionStore.redeem</c>'s own doc on why). This route never sends 401, 403, 404,
    /// 409 or a deliberate 5xx today — it is entirely unauthenticated and has no per-session
    /// existence check distinct from its one collapsed failure — but this class still classifies
    /// them defensively (never assumes only the codes seen in today's tests can ever arrive), on the
    /// conservative side described below.
    /// </para>
    /// <para>
    /// ## How an unexpected status code is classified, and why
    /// </para>
    /// <para>
    /// 429 is <see cref="PairingRedemptionOutcomeKind.RateLimited"/> — the one case where no attempt
    /// was actually processed, so a caller may safely try again later. Every other 4xx (400 and,
    /// defensively, 401/403/404/409 should a deployment ever introduce one) is
    /// <see cref="PairingRedemptionOutcomeKind.Rejected"/> — the backend explicitly answered, and
    /// retrying the same signature is never correct. 5xx is
    /// <see cref="PairingRedemptionOutcomeKind.Unreachable"/> — the server-side failure means this
    /// class genuinely does not know whether redemption happened, the same uncertainty a network
    /// timeout carries; see <see cref="IHeadsetPairingRedemptionClient"/>'s own doc on why that
    /// uncertainty is never resolved by retrying automatically.
    /// </para>
    /// </remarks>
    public static class PairingRedemptionResponseInterpreter
    {
        [Serializable]
        sealed class RedeemResponsePayload
        {
            public bool paired;
            public string deviceId;
            public string accessToken;
            public string refreshToken;
            public int expiresIn;
        }

        [Serializable]
        sealed class ErrorPayload
        {
            public string error;
            public string message;
        }

        /// <summary>A connection-level failure — the request never reached the backend, or no response ever came back.</summary>
        public static PairingRedemptionOutcome InterpretConnectionError(string transportError) =>
            PairingRedemptionOutcome.Unreachable(
                string.IsNullOrEmpty(transportError)
                    ? "Could not reach the pairing service."
                    : $"Could not reach the pairing service ({transportError}).");

        /// <summary>A response arrived but this client's own request or its handling of the response failed locally.</summary>
        public static PairingRedemptionOutcome InterpretDataProcessingError(string transportError) =>
            PairingRedemptionOutcome.Malformed("The pairing service response could not be read.");

        /// <summary>A non-2xx status actually arrived from the backend.</summary>
        public static PairingRedemptionOutcome InterpretFailureStatus(long statusCode, string responseBody)
        {
            ErrorPayload payload = TryParse<ErrorPayload>(responseBody);
            string message = payload != null && !string.IsNullOrEmpty(payload.message)
                ? payload.message
                : $"The pairing service refused this request (HTTP {statusCode}).";

            if (statusCode == 429) return PairingRedemptionOutcome.RateLimited(message);
            if (statusCode >= 500) return PairingRedemptionOutcome.Unreachable(message);
            return PairingRedemptionOutcome.Rejected(message);
        }

        /// <summary>
        /// A 2xx status arrived. Still not trusted as success on its own — see the class doc and
        /// <see cref="PairingRedemptionOutcome.Succeeded"/>'s own doc: every field a genuine success
        /// response carries is checked explicitly, and <c>paired</c> must literally be <c>true</c>.
        /// </summary>
        public static PairingRedemptionOutcome InterpretSuccessStatus(string responseBody)
        {
            RedeemResponsePayload payload = TryParse<RedeemResponsePayload>(responseBody);

            if (payload == null ||
                !payload.paired ||
                string.IsNullOrEmpty(payload.deviceId) ||
                string.IsNullOrEmpty(payload.accessToken) ||
                string.IsNullOrEmpty(payload.refreshToken) ||
                payload.expiresIn <= 0)
            {
                return PairingRedemptionOutcome.Malformed(
                    "The pairing service reported success but the response was not a genuine credential.");
            }

            return PairingRedemptionOutcome.Succeeded(new DeviceCredentials(
                payload.deviceId, payload.accessToken, payload.refreshToken, payload.expiresIn));
        }

        static TPayload TryParse<TPayload>(string json) where TPayload : class
        {
            if (string.IsNullOrEmpty(json)) return null;

            try
            {
                return JsonUtility.FromJson<TPayload>(json);
            }
            catch (Exception)
            {
                // Whatever UnityEngine.JsonUtility's exact exception type is for this input — see
                // HeadsetAdvertisementCodec's own doc on why its exact malformed-input behaviour
                // cannot be verified without a Unity Editor — every one of them means the same thing
                // here: not decodable. Never logged with the response body; a redemption response
                // can carry an access or refresh token, which must never reach a log line.
                return null;
            }
        }
    }
}
