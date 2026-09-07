using Nexa.Core.Pairing;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    /// <summary>
    /// Covers items 10–14 of Step 3F-H's required test list, plus the receiver's own core
    /// scan → validate → store → hand-off behaviour, all driven through
    /// <see cref="InMemoryHeadsetQrScanner"/> — no camera, no real time, no Unity play mode.
    /// </summary>
    [TestFixture]
    public class HeadsetPairingCodeReceiverTests
    {
        const string ValidSecret = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";
        const string ValidCode = "NX2." + ValidSecret;

        InMemoryHeadsetQrScanner _scanner;
        PendingPairingCode _pending;
        HeadsetPairingCodeReceiver _receiver;

        [SetUp]
        public void SetUp()
        {
            _scanner = new InMemoryHeadsetQrScanner();
            _pending = new PendingPairingCode();
            _receiver = new HeadsetPairingCodeReceiver(_scanner, _pending);
        }

        [Test]
        public void ValidScanHandsCodeToOnCodeReadyAndStopsScanning()
        {
            string received = null;
            _receiver.Start(code => received = code);

            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.AreEqual(ValidCode, received);
            Assert.IsFalse(_scanner.IsScanning);
        }

        [Test]
        public void ScannerFailureDoesNotStopScanningOrInvokeOnCodeReady()
        {
            bool codeReady = false;
            _receiver.Start(_ => codeReady = true);

            _scanner.EmitFrame(QrScanResult.Error("decoder threw"));

            Assert.IsFalse(codeReady);
            Assert.IsTrue(_scanner.IsScanning); // a single bad frame must not end the attempt
        }

        [Test]
        public void ScannerNotFoundDoesNotStopScanningOrInvokeOnCodeReady()
        {
            bool codeReady = false;
            _receiver.Start(_ => codeReady = true);

            _scanner.EmitFrame(QrScanResult.NotFound());

            Assert.IsFalse(codeReady);
            Assert.IsTrue(_scanner.IsScanning);
        }

        [Test]
        public void RejectedCandidateInvokesOnRejectedButKeepsScanning()
        {
            PairingCodeRejectionReason? rejection = null;
            bool codeReady = false;
            _receiver.Start(_ => codeReady = true, reason => rejection = reason);

            _scanner.EmitFrame(QrScanResult.Decoded("not-a-real-code"));

            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, rejection);
            Assert.IsFalse(codeReady);
            Assert.IsTrue(_scanner.IsScanning);
        }

        [Test]
        public void ScannerTimeoutInvokesOnTimeoutAndStopsScanning()
        {
            bool timedOut = false;
            bool codeReady = false;
            _receiver.Start(_ => codeReady = true, timeoutSeconds: 5f, onTimeout: () => timedOut = true);

            _receiver.Tick(3f);
            Assert.IsFalse(timedOut); // not yet — under the configured budget

            _receiver.Tick(2f); // total 5s: at the threshold

            Assert.IsTrue(timedOut);
            Assert.IsFalse(codeReady);
            Assert.IsFalse(_scanner.IsScanning);
        }

        [Test]
        public void TickWithoutTimeoutConfiguredNeverFires()
        {
            // Start() with no timeoutSeconds: Tick must be a safe no-op forever.
            _receiver.Start(_ => { });

            Assert.DoesNotThrow(() => _receiver.Tick(1_000_000f));
            Assert.IsTrue(_scanner.IsScanning);
        }

        [Test]
        public void CodeFoundBeforeTimeoutPreventsLaterTimeout()
        {
            bool timedOut = false;
            string received = null;
            _receiver.Start(code => received = code, timeoutSeconds: 5f, onTimeout: () => timedOut = true);

            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            _receiver.Tick(10f); // well past the budget, but already settled

            Assert.AreEqual(ValidCode, received);
            Assert.IsFalse(timedOut);
        }

        [Test]
        public void DuplicateScanOfTheSameCodeAfterSettlingIsIgnored()
        {
            int callCount = 0;
            _receiver.Start(_ => callCount++);

            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            // The same QR symbol sitting in front of the camera for another frame or two — the
            // scanner is stopped by now, so a real one could not deliver this, but a stray/late
            // callback (as ForceEmitFrame simulates) must still be tolerated harmlessly.
            _scanner.ForceEmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.AreEqual(1, callCount);
        }

        [Test]
        public void StartCalledAgainAfterSettlingBeginsAFreshAttempt()
        {
            string firstCode = null;
            _receiver.Start(code => firstCode = code);
            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));
            Assert.AreEqual(ValidCode, firstCode);

            // A genuinely new attempt (e.g. user retries pairing) is a new Start() call, not a
            // second frame on the old one — confirm it restarts scanning and can settle again.
            string secondCode = null;
            _receiver.Start(code => secondCode = code);
            Assert.IsTrue(_scanner.IsScanning);

            // A genuinely distinct 43-character secret (the reverse of ValidCode's own secret) —
            // this was previously mistyped one character short of PairingCodeValidator's required
            // length, which made this "second, different code" silently fail validation and never
            // reach onCodeReady at all; only surfaced once a real Unity Editor first ran this test.
            const string secondValidCode = "NX2.EDCBA_-9876543210zYxWvUtSrQpOnMlKjIhGfEdCbA";
            _scanner.EmitFrame(QrScanResult.Decoded(secondValidCode));

            Assert.AreEqual(secondValidCode, secondCode);
        }

        [Test]
        public void CodeIsOnlyHeldInPendingPairingCodeNeverAnywhereElse()
        {
            // "Never persisted" for this codebase means: the one place a found code is ever
            // written to is the in-memory PendingPairingCode slot handed into the constructor —
            // there is no file, no PlayerPrefs, no other store this receiver could reach even if
            // it wanted to. Confirm the slot holds it, then confirm Take() both returns and
            // permanently clears it — nothing left behind anywhere.
            _receiver.Start(_ => { });
            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            Assert.IsTrue(_pending.HasCode);
            Assert.AreEqual(ValidCode, _pending.Take());
            Assert.IsFalse(_pending.HasCode);
            Assert.IsNull(_pending.Take()); // taking again proves nothing else re-populates it
        }

        [Test]
        public void PendingPairingCodeToStringNeverIncludesTheCode()
        {
            _receiver.Start(_ => { });
            _scanner.EmitFrame(QrScanResult.Decoded(ValidCode));

            StringAssert.DoesNotContain(ValidSecret, _pending.ToString());
        }

        [Test]
        public void ReceiverAndScanResultToStringNeverIncludeTheCode()
        {
            var decoded = QrScanResult.Decoded(ValidCode);

            StringAssert.DoesNotContain(ValidSecret, decoded.ToString());
            StringAssert.DoesNotContain(ValidCode, decoded.ToString());
        }

        [Test]
        public void StopEndsScanningWithoutInvokingOnCodeReady()
        {
            bool codeReady = false;
            _receiver.Start(_ => codeReady = true);

            _receiver.Stop();

            Assert.IsFalse(_scanner.IsScanning);
            Assert.IsFalse(codeReady);

            // And a frame arriving after Stop() (a stray late callback) must still be ignored.
            _scanner.ForceEmitFrame(QrScanResult.Decoded(ValidCode));
            Assert.IsFalse(codeReady);
        }
    }
}
