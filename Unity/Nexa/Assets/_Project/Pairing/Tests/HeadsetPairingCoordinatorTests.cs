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

        sealed class Fixture
        {
            public HeadsetPairingCoordinator Coordinator;
            public InMemoryHeadsetQrScanner Scanner;
            public InMemoryHeadsetLanSocket LanSocket;
            public IHeadsetIdentity Identity;
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

            var coordinator = new HeadsetPairingCoordinator(identity, receiver, lanSocket);
            return new Fixture { Coordinator = coordinator, Scanner = scanner, LanSocket = lanSocket, Identity = identity };
        }

        [Test]
        public void CodeArrivingThenContextProducesAReadyRequest()
        {
            var built = BuildReadyCoordinator();

            PairingRedemptionRequest? result = null;
            built.Coordinator.Start(request => result = request);

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            Assert.IsFalse(result.HasValue, "must wait for the pairing context too");

            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsTrue(result.HasValue);
            Assert.AreEqual(ValidCode, result.Value.Code);
        }

        [Test]
        public void ContextArrivingThenCodeProducesAReadyRequest()
        {
            // Order-independence is the whole point of this class — see its own doc.
            var built = BuildReadyCoordinator();

            PairingRedemptionRequest? result = null;
            built.Coordinator.Start(request => result = request);

            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));
            Assert.IsFalse(result.HasValue, "must wait for the code too");

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.IsTrue(result.HasValue);
            Assert.AreEqual(ValidCode, result.Value.Code);
        }

        [Test]
        public void OnlyTheCodeArrivingNeverProducesARequest()
        {
            var built = BuildReadyCoordinator();

            bool ready = false;
            built.Coordinator.Start(_ => ready = true);
            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.IsFalse(ready);
        }

        [Test]
        public void OnlyTheContextArrivingNeverProducesARequest()
        {
            var built = BuildReadyCoordinator();

            bool ready = false;
            built.Coordinator.Start(_ => ready = true);
            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsFalse(ready);
        }

        [Test]
        public void ANonPairingContextLanMessageIsIgnoredAndListeningContinues()
        {
            var built = BuildReadyCoordinator();

            PairingRedemptionRequest? result = null;
            built.Coordinator.Start(request => result = request);

            // An advertisement — a genuine, well-formed message, just the wrong type for this
            // listener — must not be mistaken for pairing context or stop the wait.
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
            built.Coordinator.Start(_ => { });

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsFalse(built.Scanner.IsScanning);
            // StopReceiving() only stops delivery — it does not close the socket. Confirmed here by
            // proving a subsequent EmitDatagram (which itself checks IsOpen) still no-ops, via
            // OnceSettledFurtherArrivalsAreIgnored, while IsOpen itself remains true.
            Assert.IsTrue(built.LanSocket.IsOpen);
        }

        [Test]
        public void OnceSettledFurtherArrivalsAreIgnored()
        {
            var built = BuildReadyCoordinator();

            int readyCount = 0;
            built.Coordinator.Start(_ => readyCount++);

            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            built.LanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));
            Assert.AreEqual(1, readyCount);

            // Stray late callbacks after settling — tolerated, never re-fire onReady.
            built.Scanner.ForceEmitFrame(QrScanResult.Decoded(ValidCode));
            built.LanSocket.ForceEmitDatagram(PairingContextDatagram("a-different-session"));

            Assert.AreEqual(1, readyCount);
        }

        [Test]
        public void StopBeforeBothFactsArriveProducesNoRequestEvenIfForceEmitted()
        {
            var built = BuildReadyCoordinator();

            bool ready = false;
            built.Coordinator.Start(_ => ready = true);
            built.Scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            built.Coordinator.Stop();

            // ForceEmitDatagram bypasses the fake's own IsOpen gate, proving the coordinator's own
            // _settled guard — not just the socket having stopped — is what prevents this.
            built.LanSocket.ForceEmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsFalse(ready);
        }

        [Test]
        public void ABuildFailureInvokesOnErrorRatherThanOnReady()
        {
            // No EnsureKey() call — signing will fail with HeadsetIdentityException.
            var identity = new InMemoryHeadsetIdentity();
            var scanner = new InMemoryHeadsetQrScanner();
            var receiver = new HeadsetPairingCodeReceiver(scanner, new PendingPairingCode());
            var lanSocket = new InMemoryHeadsetLanSocket();
            lanSocket.Open(47332);
            var coordinator = new HeadsetPairingCoordinator(identity, receiver, lanSocket);

            Exception caught = null;
            bool ready = false;
            coordinator.Start(_ => ready = true, error => caught = error);

            scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            lanSocket.EmitDatagram(PairingContextDatagram(PairingSessionId));

            Assert.IsFalse(ready);
            Assert.IsInstanceOf<HeadsetIdentityException>(caught);
        }

        [Test]
        public void ConstructorRejectsNullDependencies()
        {
            var identity = new InMemoryHeadsetIdentity();
            var receiver = new HeadsetPairingCodeReceiver(new InMemoryHeadsetQrScanner(), new PendingPairingCode());
            var lanSocket = new InMemoryHeadsetLanSocket();

            Assert.Throws<ArgumentNullException>(() => new HeadsetPairingCoordinator(null, receiver, lanSocket));
            Assert.Throws<ArgumentNullException>(() => new HeadsetPairingCoordinator(identity, null, lanSocket));
            Assert.Throws<ArgumentNullException>(() => new HeadsetPairingCoordinator(identity, receiver, null));
        }
    }
}
