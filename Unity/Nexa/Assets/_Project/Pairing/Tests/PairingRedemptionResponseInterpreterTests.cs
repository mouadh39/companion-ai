using Nexa.Core.Pairing;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    /// <summary>
    /// Exercises the actual HTTP-response interpretation logic
    /// <see cref="UnityHeadsetPairingRedemptionClient"/> delegates to — entirely in EditMode, with
    /// no network, no coroutine, and no <c>UnityWebRequest</c> involved. Every status/body
    /// combination here is checked against the real backend contract
    /// (<c>POST /v1/pairing-sessions/redeem</c> in <c>apps/backend/src/server.ts</c>), not guessed.
    /// </summary>
    [TestFixture]
    public class PairingRedemptionResponseInterpreterTests
    {
        const string SuccessBody =
            "{\"paired\":true,\"deviceId\":\"headset-1\",\"accessToken\":\"acc-1\",\"refreshToken\":\"ref-1\",\"expiresIn\":1209600}";

        // ------------------------------------------------------------------
        // Success
        // ------------------------------------------------------------------

        [Test]
        public void AGenuineSuccessResponseParsesToSucceededWithTheRightCredentials()
        {
            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretSuccessStatus(SuccessBody);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Succeeded, outcome.Kind);
            Assert.IsTrue(outcome.Credentials.HasValue);
            Assert.AreEqual("headset-1", outcome.Credentials.Value.DeviceId);
            Assert.AreEqual("acc-1", outcome.Credentials.Value.AccessToken);
            Assert.AreEqual("ref-1", outcome.Credentials.Value.RefreshToken);
            Assert.AreEqual(1209600, outcome.Credentials.Value.ExpiresInSeconds);
        }

        [Test]
        public void ExtraUnknownFieldsInASuccessResponseDoNotPreventSuccess()
        {
            string body =
                "{\"paired\":true,\"deviceId\":\"headset-1\",\"accessToken\":\"acc-1\"," +
                "\"refreshToken\":\"ref-1\",\"expiresIn\":100,\"somethingFuture\":42}";

            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretSuccessStatus(body);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Succeeded, outcome.Kind);
        }

        // ------------------------------------------------------------------
        // Invalid / malformed success-shaped responses — never treated as success
        // ------------------------------------------------------------------

        [Test]
        public void PairedFalseIsNeverTreatedAsSuccessEvenWithEveryOtherFieldPresent()
        {
            string body =
                "{\"paired\":false,\"deviceId\":\"headset-1\",\"accessToken\":\"acc-1\"," +
                "\"refreshToken\":\"ref-1\",\"expiresIn\":100}";

            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretSuccessStatus(body);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Malformed, outcome.Kind);
            Assert.IsFalse(outcome.Credentials.HasValue);
        }

        [Test]
        public void AMissingAccessTokenIsMalformed()
        {
            string body = "{\"paired\":true,\"deviceId\":\"headset-1\",\"refreshToken\":\"ref-1\",\"expiresIn\":100}";
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus(body).Kind);
        }

        [Test]
        public void AMissingRefreshTokenIsMalformed()
        {
            string body = "{\"paired\":true,\"deviceId\":\"headset-1\",\"accessToken\":\"acc-1\",\"expiresIn\":100}";
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus(body).Kind);
        }

        [Test]
        public void AMissingDeviceIdIsMalformed()
        {
            string body = "{\"paired\":true,\"accessToken\":\"acc-1\",\"refreshToken\":\"ref-1\",\"expiresIn\":100}";
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus(body).Kind);
        }

        [Test]
        public void AZeroOrNegativeExpiresInIsMalformed()
        {
            string zero = "{\"paired\":true,\"deviceId\":\"h\",\"accessToken\":\"a\",\"refreshToken\":\"r\",\"expiresIn\":0}";
            string negative = "{\"paired\":true,\"deviceId\":\"h\",\"accessToken\":\"a\",\"refreshToken\":\"r\",\"expiresIn\":-5}";

            Assert.AreEqual(PairingRedemptionOutcomeKind.Malformed, PairingRedemptionResponseInterpreter.InterpretSuccessStatus(zero).Kind);
            Assert.AreEqual(PairingRedemptionOutcomeKind.Malformed, PairingRedemptionResponseInterpreter.InterpretSuccessStatus(negative).Kind);
        }

        [Test]
        public void AnEmptySuccessBodyIsMalformedNotSucceeded()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus("").Kind);
        }

        [Test]
        public void ANullSuccessBodyIsMalformedNotSucceeded()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus(null).Kind);
        }

        [Test]
        public void GarbageInsteadOfJsonInASuccessResponseIsMalformedNeverThrows()
        {
            PairingRedemptionOutcome outcome = default;
            Assert.DoesNotThrow(() =>
                outcome = PairingRedemptionResponseInterpreter.InterpretSuccessStatus("not json at all { { {"));
            Assert.AreEqual(PairingRedemptionOutcomeKind.Malformed, outcome.Kind);
        }

        // ------------------------------------------------------------------
        // Failure status codes — bucketed exactly as the backend contract and the class doc describe
        // ------------------------------------------------------------------

        [Test]
        public void Http400WithABackendMessageIsRejectedWithThatMessage()
        {
            string body = "{\"error\":\"invalid_request\",\"message\":\"That pairing code could not be redeemed.\"}";

            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretFailureStatus(400, body);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Rejected, outcome.Kind);
            Assert.AreEqual("That pairing code could not be redeemed.", outcome.Message);
        }

        [Test]
        public void Http400WithNoParsableBodyStillRejectsWithASafeFallbackMessage()
        {
            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretFailureStatus(400, "");

            Assert.AreEqual(PairingRedemptionOutcomeKind.Rejected, outcome.Kind);
            StringAssert.Contains("400", outcome.Message);
        }

        [Test]
        public void Http401IsRejected()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Rejected,
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(401, "").Kind);
        }

        [Test]
        public void Http403IsRejected()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Rejected,
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(403, "").Kind);
        }

        [Test]
        public void Http404IsRejected()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Rejected,
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(404, "").Kind);
        }

        [Test]
        public void Http409IsRejected()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Rejected,
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(409, "").Kind);
        }

        [Test]
        public void Http429IsRateLimitedNotRejected()
        {
            string body = "{\"error\":\"rate_limited\",\"message\":\"Too many redemption attempts. Try again shortly.\"}";

            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretFailureStatus(429, body);

            Assert.AreEqual(PairingRedemptionOutcomeKind.RateLimited, outcome.Kind);
            Assert.AreEqual("Too many redemption attempts. Try again shortly.", outcome.Message);
        }

        [Test]
        public void Http500IsUnreachableNotRejected()
        {
            // A 5xx is genuinely ambiguous about whether redemption happened server-side — see
            // IHeadsetPairingRedemptionClient's own doc — so it is bucketed with connection
            // failures, never with a definite rejection.
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Unreachable,
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(500, "").Kind);
        }

        [Test]
        public void Http502And503AreAlsoUnreachable()
        {
            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, PairingRedemptionResponseInterpreter.InterpretFailureStatus(502, "").Kind);
            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, PairingRedemptionResponseInterpreter.InterpretFailureStatus(503, "").Kind);
        }

        // ------------------------------------------------------------------
        // Connection-level failures
        // ------------------------------------------------------------------

        [Test]
        public void AConnectionErrorIsUnreachable()
        {
            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretConnectionError("Connection refused");

            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, outcome.Kind);
            StringAssert.Contains("Connection refused", outcome.Message);
        }

        [Test]
        public void AConnectionErrorWithNoDetailStillProducesASafeGenericMessage()
        {
            PairingRedemptionOutcome outcome = default;
            Assert.DoesNotThrow(() => outcome = PairingRedemptionResponseInterpreter.InterpretConnectionError(null));
            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, outcome.Kind);
            Assert.IsFalse(string.IsNullOrEmpty(outcome.Message));
        }

        [Test]
        public void ATimeoutSurfacesThroughTheSameConnectionErrorPathAsAnyOtherTransportFailure()
        {
            // UnityWebRequest reports a timeout as Result.ConnectionError with its own error text —
            // there is no separate "timeout" transport result to interpret differently, so this
            // pins that a timeout-shaped message still resolves to Unreachable like any other.
            PairingRedemptionOutcome outcome = PairingRedemptionResponseInterpreter.InterpretConnectionError("Request timeout");

            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, outcome.Kind);
        }

        [Test]
        public void ADataProcessingErrorIsMalformed()
        {
            Assert.AreEqual(
                PairingRedemptionOutcomeKind.Malformed,
                PairingRedemptionResponseInterpreter.InterpretDataProcessingError("bad request encoding").Kind);
        }

        // ------------------------------------------------------------------
        // Security: nothing here ever produces credentials except a genuine success
        // ------------------------------------------------------------------

        [Test]
        public void NoFailureOutcomeOfAnyKindEverCarriesCredentials()
        {
            PairingRedemptionOutcome[] failures =
            {
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(400, "{}"),
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(429, "{}"),
                PairingRedemptionResponseInterpreter.InterpretFailureStatus(500, "{}"),
                PairingRedemptionResponseInterpreter.InterpretConnectionError("x"),
                PairingRedemptionResponseInterpreter.InterpretDataProcessingError("x"),
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus("not-json"),
                PairingRedemptionResponseInterpreter.InterpretSuccessStatus("{\"paired\":false}"),
            };

            foreach (PairingRedemptionOutcome outcome in failures)
            {
                Assert.AreNotEqual(PairingRedemptionOutcomeKind.Succeeded, outcome.Kind);
                Assert.IsFalse(outcome.Credentials.HasValue);
            }
        }
    }
}
