using System;
using System.Text;
using Nexa.Core.Identity;
using Nexa.Core.Pairing;
using Nexa.Identity;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    [TestFixture]
    public class HeadsetPairingCoordinatorTests
    {
        const string ValidCode = "NX2.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";
        const string PairingSessionId = "pairing-session-001";

        static LanDatagram PairingContextDatagram(string pairingSessionId)
        {
            string raw = PairingContextCodec.Encode(new PairingContextMessage(pairingSessionId));
            return new LanDatagram(Encoding.UTF8.GetBytes(raw), "192.168.1.10", 47332);
        }

        static DeviceCredentials SampleCredentials() =>
            new DeviceCredentials("headset-device-1", "the-access-token", "the-refresh-token", 1209600);

        sealed class Fixture
        {
            public HeadsetPairingCoordinator Coordinator;
            public InMemoryHeadsetQrScanner Scanner;
            public InMemoryHeadsetLanSocket LanSocket;
            public IHeadsetIdentity Identity;
            public InMemoryHeadsetPairingRedemptionClient RedemptionClient;
            public InMemoryHeadsetCredentialStore CredentialStore;
        }

        static Fixture BuildReadyCoordinator()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();
            var scanner = new InMemoryHeadsetQrScanner();
            var pending = new PendingPairingCode();
            var receiver = new HeadsetPairingCodeReceiver(scanner, pending);
            var lanSocket = new InMemoryHeadsetLanSocket();
            lanSocket.Open(47332);
            var redemptionClient = new InMemoryHeadsetPairingRedemptionClient
            {
                NextOutcome = PairingRedemptionOutcome.Succeeded(SampleCredentials()),
            };
            var credentialStore = new InMemoryHeadsetCredentialStore();

            var coordinator = new HeadsetPairingCoordinator(identity, receiver, lanSocket, redemptionClient, credentialStore);
            return new Fixture
            {
                Coordinator = coordinator,
                Scanner = scanner,
                LanSocket = lanSocket,
                Identity = identity,
                RedemptionClient = redemptionClient,
                CredentialStore = credentialStore,
            };
        }

        static void CompletePairing(Fixture built)
        {
            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));
        }

        // ------------------------------------------------------------------
        // End-to-end success
        // ------------------------------------------------------------------

        [Test]
        public void CodeArrivingThenContextEventuallyReportsPaired()
        {
            var built = BuildReadyCoordinator();

            DeviceCredentials? result = null;
            built.Coordinator.Start(c => result = c, _ => Assert.Fail("must not report redemption failure"));

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            Assert.IsFalse(result.HasValue, "must wait for the pairing context too");

            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsTrue(result.HasValue);
            Assert.AreEqual("headset-device-1", result.Value.DeviceId);
        }

        [Test]
        public void ContextArrivingThenCodeEventuallyReportsPaired()
        {
            // Order-independence is the whole point of this class — see its own doc.
            var built = BuildReadyCoordinator();

            DeviceCredentials? result = null;
            built.Coordinator.Start(c => result = c, _ => Assert.Fail("must not report redemption failure"));

            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));
            Assert.IsFalse(result.HasValue, "must wait for the code too");

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.IsTrue(result.HasValue);
        }

        [Test]
        public void OnlyTheCodeArrivingNeverReportsPairedOrFailed()
        {
            var built = BuildReadyCoordinator();

            bool called = false;
            built.Coordinator.Start(_ => called = true, _ => called = true);
            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.IsFalse(called);
        }

        [Test]
        public void PairedCredentialsAreSavedToTheCredentialStoreBeforeOnPairedFires()
        {
            var built = BuildReadyCoordinator();

            bool savedBeforeCallback = false;
            built.Coordinator.Start(
                _ => savedBeforeCallback = built.CredentialStore.HasCredentials,
                _ => Assert.Fail("must not fail"));

            CompletePairing(built);

            Assert.IsTrue(savedBeforeCallback);
            Assert.AreEqual("headset-device-1", built.CredentialStore.Load().DeviceId);
        }

        // ------------------------------------------------------------------
        // Redemption failure — the backend is authoritative, never this class
        // ------------------------------------------------------------------

        [Test]
        public void ARejectedRedemptionReportsFailureNeverPaired()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.Rejected("That pairing code could not be redeemed.");

            PairingRedemptionOutcome? failure = null;
            built.Coordinator.Start(_ => Assert.Fail("must not report paired"), outcome => failure = outcome);

            CompletePairing(built);

            Assert.IsTrue(failure.HasValue);
            Assert.AreEqual(PairingRedemptionOutcomeKind.Rejected, failure.Value.Kind);
            Assert.IsFalse(built.CredentialStore.HasCredentials);
        }

        [Test]
        public void AnUnreachableBackendReportsFailureNeverPaired()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.Unreachable("Could not reach the pairing service.");

            PairingRedemptionOutcome? failure = null;
            built.Coordinator.Start(_ => Assert.Fail("must not report paired"), outcome => failure = outcome);

            CompletePairing(built);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Unreachable, failure.Value.Kind);
            Assert.IsFalse(built.CredentialStore.HasCredentials);
        }

        [Test]
        public void ARateLimitedBackendReportsFailureNeverPaired()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.RateLimited("Too many attempts.");

            PairingRedemptionOutcome? failure = null;
            built.Coordinator.Start(_ => Assert.Fail("must not report paired"), outcome => failure = outcome);

            CompletePairing(built);

            Assert.AreEqual(PairingRedemptionOutcomeKind.RateLimited, failure.Value.Kind);
            Assert.IsFalse(built.CredentialStore.HasCredentials);
        }

        [Test]
        public void AMalformedResponseReportsFailureNeverPaired()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.Malformed("The response could not be read.");

            PairingRedemptionOutcome? failure = null;
            built.Coordinator.Start(_ => Assert.Fail("must not report paired"), outcome => failure = outcome);

            CompletePairing(built);

            Assert.AreEqual(PairingRedemptionOutcomeKind.Malformed, failure.Value.Kind);
            Assert.IsFalse(built.CredentialStore.HasCredentials);
        }

        [Test]
        public void ABuildFailureInvokesOnBuildErrorRatherThanEitherOutcomeCallback()
        {
            // No EnsureKey() call — signing will fail with HeadsetIdentityException, before the
            // redemption client is ever reached.
            var identity = new InMemoryHeadsetIdentity();
            var scanner = new InMemoryHeadsetQrScanner();
            var receiver = new HeadsetPairingCodeReceiver(scanner, new PendingPairingCode());
            var lanSocket = new InMemoryHeadsetLanSocket();
            lanSocket.Open(47332);
            var redemptionClient = new InMemoryHeadsetPairingRedemptionClient();
            var credentialStore = new InMemoryHeadsetCredentialStore();
            var coordinator = new HeadsetPairingCoordinator(identity, receiver, lanSocket, redemptionClient, credentialStore);

            Exception caught = null;
            coordinator.Start(
                _ => Assert.Fail("must not report paired"),
                _ => Assert.Fail("must not report a redemption outcome — the request was never sent"),
                error => caught = error);

            scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            lanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsInstanceOf<HeadsetIdentityException>(caught);
            Assert.AreEqual(0, redemptionClient.Calls.Count, "the redemption client must never be called at all");
        }

        // ------------------------------------------------------------------
        // Security: exactly what leaves the device, and what a failure can never do
        // ------------------------------------------------------------------

        [Test]
        public void TheRedemptionRequestCarriesOnlyTheCodeAndSignatureNothingElse()
        {
            var built = BuildReadyCoordinator();
            built.Coordinator.Start(_ => { }, _ => { });

            CompletePairing(built);

            Assert.AreEqual(1, built.RedemptionClient.Calls.Count);
            var call = built.RedemptionClient.Calls[0];
            Assert.AreEqual(ValidCode, call.Code);
            Assert.IsFalse(string.IsNullOrEmpty(call.SignatureBase64));
            // These two fields are the entire recorded call — there is no third field on
            // InMemoryHeadsetPairingRedemptionClient.RecordedCall for anything else to hide in,
            // the same way IHeadsetPairingRedemptionClient.Redeem's own signature has no parameter
            // for a private key, a password, a Supabase token, or a refresh token to travel through.
        }

        [Test]
        public void APrivateKeyNeverAppearsInTheRedemptionCallAsATextValue()
        {
            var built = BuildReadyCoordinator();
            built.Coordinator.Start(_ => { }, _ => { });

            CompletePairing(built);

            var call = built.RedemptionClient.Calls[0];
            // The identity's own public key id is the only "identity-shaped" string that could
            // plausibly leak here by a mistake in wiring — confirm neither recorded field equals
            // or contains it. (The private key itself never exists as a string anywhere in this
            // process — see IHeadsetIdentity's own doc — so this is the closest a test can get to
            // asserting its absence directly.)
            string publicKeyId = built.Identity.PublicKeyId;
            StringAssert.DoesNotContain(publicKeyId, call.Code);
            StringAssert.DoesNotContain(publicKeyId, call.SignatureBase64);
        }

        [Test]
        public void AccessAndRefreshTokensNeverAppearInTheOutgoingRedemptionRequest()
        {
            // Tokens are what redemption PRODUCES, never something available before it — this test
            // pins that fact by using tokens a genuine response could plausibly contain and
            // confirming they cannot appear in what was already sent by the time any response
            // exists.
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.Succeeded(SampleCredentials());
            built.Coordinator.Start(_ => { }, _ => { });

            CompletePairing(built);

            var call = built.RedemptionClient.Calls[0];
            StringAssert.DoesNotContain("the-access-token", call.Code);
            StringAssert.DoesNotContain("the-access-token", call.SignatureBase64);
            StringAssert.DoesNotContain("the-refresh-token", call.Code);
            StringAssert.DoesNotContain("the-refresh-token", call.SignatureBase64);
        }

        [Test]
        public void AFailedRedemptionNeverSavesCredentialsEvenIfOutcomeCarriesNone()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.NextOutcome = PairingRedemptionOutcome.Rejected("no");

            built.Coordinator.Start(_ => { }, _ => { });
            CompletePairing(built);

            Assert.IsFalse(built.CredentialStore.HasCredentials);
        }

        [Test]
        public void OutcomeToStringNeverIncludesCredentialTokens()
        {
            var outcome = PairingRedemptionOutcome.Succeeded(SampleCredentials());
            StringAssert.DoesNotContain("the-access-token", outcome.ToString());
            StringAssert.DoesNotContain("the-refresh-token", outcome.ToString());
        }

        // ------------------------------------------------------------------
        // Settling and stray callbacks
        // ------------------------------------------------------------------

        [Test]
        public void ANonPairingContextLanMessageIsIgnoredAndListeningContinues()
        {
            var built = BuildReadyCoordinator();

            DeviceCredentials? result = null;
            built.Coordinator.Start(c => result = c, _ => Assert.Fail("must not fail"));

            string advertisementRaw = HeadsetAdvertisementCodec.Encode(
                new HeadsetAdvertisement("Some Other Headset", "unrelated-handle", DateTime.UtcNow));
            built.LanSocket.EmitDatagram(new LanDatagram(Encoding.UTF8.GetBytes(advertisementRaw), "10.0.0.5", 1));

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            Assert.IsFalse(result.HasValue, "still waiting on a real pairing_context message");

            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));
            Assert.IsTrue(result.HasValue);
        }

        [Test]
        public void OnceSettledScanningStopsAndTheSocketStopsReceivingButStaysOpen()
        {
            var built = BuildReadyCoordinator();
            built.Coordinator.Start(_ => { }, _ => { });

            CompletePairing(built);

            Assert.IsFalse(built.Scanner.IsScanning);
            Assert.IsTrue(built.LanSocket.IsOpen);
        }

        [Test]
        public void OnceSettledFurtherArrivalsNeverTriggerASecondRedemptionCall()
        {
            var built = BuildReadyCoordinator();

            int pairedCount = 0;
            built.Coordinator.Start(_ => pairedCount++, _ => { });

            CompletePairing(built);
            Assert.AreEqual(1, pairedCount);
            Assert.AreEqual(1, built.RedemptionClient.Calls.Count);

            built.Scanner.ForceEmitFrame(QrScanResult.Decoded(ValidCode));
            built.LanSocket.ForceEmitDatagram(PairingContextDatagram("a-different-session"));

            Assert.AreEqual(1, pairedCount);
            Assert.AreEqual(1, built.RedemptionClient.Calls.Count);
        }

        [Test]
        public void StopBeforeBothFactsArriveProducesNoRedemptionCallEvenIfForceEmitted()
        {
            var built = BuildReadyCoordinator();

            bool called = false;
            built.Coordinator.Start(_ => called = true, _ => called = true);
            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            built.Coordinator.Stop();

            built.LanSocket.ForceEmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsFalse(called);
            Assert.AreEqual(0, built.RedemptionClient.Calls.Count);
        }

        [Test]
        public void StopAfterRedemptionIsDispatchedSuppressesTheOutcomeWhenItLaterArrives()
        {
            var built = BuildReadyCoordinator();
            built.RedemptionClient.DeliverSynchronously = false; // simulate a real, async HTTP call

            bool called = false;
            built.Coordinator.Start(_ => called = true, _ => called = true);
            CompletePairing(built); // dispatches the redemption call; nothing has answered yet

            Assert.AreEqual(1, built.RedemptionClient.Calls.Count, "the request must already be in flight");

            built.Coordinator.Stop();
            built.RedemptionClient.CompletePending(); // the "server" answers only now, after Stop()

            Assert.IsFalse(called, "a result arriving after Stop() must never reach either callback");
        }

        [Test]
        public void ConstructorRejectsNullDependencies()
        {
            var identity = new InMemoryHeadsetIdentity();
            var receiver = new HeadsetPairingCodeReceiver(new InMemoryHeadsetQrScanner(), new PendingPairingCode());
            var lanSocket = new InMemoryHeadsetLanSocket();
            var redemptionClient = new InMemoryHeadsetPairingRedemptionClient();
            var credentialStore = new InMemoryHeadsetCredentialStore();

            Assert.Throws<ArgumentNullException>(() =>
                new HeadsetPairingCoordinator(null, receiver, lanSocket, redemptionClient, credentialStore));
            Assert.Throws<ArgumentNullException>(() =>
                new HeadsetPairingCoordinator(identity, null, lanSocket, redemptionClient, credentialStore));
            Assert.Throws<ArgumentNullException>(() =>
                new HeadsetPairingCoordinator(identity, receiver, null, redemptionClient, credentialStore));
            Assert.Throws<ArgumentNullException>(() =>
                new HeadsetPairingCoordinator(identity, receiver, lanSocket, null, credentialStore));
            Assert.Throws<ArgumentNullException>(() =>
                new HeadsetPairingCoordinator(identity, receiver, lanSocket, redemptionClient, null));
        }

        [Test]
        public void StartRejectsNullRequiredCallbacks()
        {
            var built = BuildReadyCoordinator();

            Assert.Throws<ArgumentNullException>(() => built.Coordinator.Start(null, _ => { }));
            Assert.Throws<ArgumentNullException>(() => built.Coordinator.Start(_ => { }, null));
        }
    }
}
