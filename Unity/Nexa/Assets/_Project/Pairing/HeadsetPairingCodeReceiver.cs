using System;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// Wires a scanner, validation, and short-lived state together: the whole path from
    /// "a camera frame arrived" to "a genuine pairing code is ready for the next stage."
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the one class in <c>Nexa.Pairing</c> that knows about all three of
    /// <see cref="IHeadsetQrScanner"/>, <see cref="PairingCodeValidator"/>, and
    /// <see cref="PendingPairingCode"/> at once — everything else in this namespace knows about
    /// at most one of them. Composing them here, rather than leaving a caller to sequence
    /// scan → validate → store correctly itself, is the same "one domain operation, one owner"
    /// reasoning the backend's own store classes document for exactly the same reason.
    /// </para>
    /// <para>
    /// Stops scanning the instant a valid code is found — a live QR code sitting in front of the
    /// camera for another frame or two must not be read twice and treated as two separate
    /// attempts. A rejected candidate (malformed, or simply not a QR the validator recognises)
    /// does the opposite: scanning continues, because one bad frame — a stray URL somebody else's
    /// QR code happened to show, a partially-occluded read — says nothing about whether the next
    /// frame holds a genuine code.
    /// </para>
    /// </remarks>
    public sealed class HeadsetPairingCodeReceiver
    {
        readonly IHeadsetQrScanner _scanner;
        readonly PendingPairingCode _pending;

        bool _settled;
        float? _timeoutSeconds;
        float _elapsedSeconds;
        Action _onTimeout;

        public HeadsetPairingCodeReceiver(IHeadsetQrScanner scanner, PendingPairingCode pending)
        {
            _scanner = scanner ?? throw new ArgumentNullException(nameof(scanner));
            _pending = pending ?? throw new ArgumentNullException(nameof(pending));
        }

        /// <summary>
        /// Begins scanning. <paramref name="onCodeReady"/> is invoked exactly once, with a
        /// validated code already placed in <see cref="PendingPairingCode"/>, the first time one
        /// is found. <paramref name="onRejected"/>, if given, is invoked for every scanned
        /// candidate the validator refuses — scanning continues regardless.
        /// </summary>
        /// <param name="timeoutSeconds">
        /// If given, how many cumulative seconds of <see cref="Tick"/> calls this receiver
        /// tolerates without a valid code before giving up on its own. <c>null</c> (the default)
        /// means no timeout — the caller decides how long is too long, or never gives up.
        /// </param>
        /// <param name="onTimeout">
        /// Invoked at most once, if and only if <paramref name="timeoutSeconds"/> elapses before
        /// a valid code is found. Ignored if <paramref name="timeoutSeconds"/> is <c>null</c>.
        /// </param>
        public void Start(
            Action<string> onCodeReady,
            Action<PairingCodeRejectionReason> onRejected = null,
            float? timeoutSeconds = null,
            Action onTimeout = null)
        {
            if (onCodeReady == null) throw new ArgumentNullException(nameof(onCodeReady));

            _settled = false;
            _timeoutSeconds = timeoutSeconds;
            _elapsedSeconds = 0f;
            _onTimeout = onTimeout;
            _scanner.StartScanning(result =>
            {
                // Guards against a scanner implementation that delivers one more result after
                // StopScanning() was already called — the fake used in tests can do this
                // deliberately, to prove this class tolerates it, and a real one might do it by
                // accident under real timing. Either way, a second callback after this receiver
                // has already settled must never re-fire onCodeReady or re-set the pending code.
                if (_settled) return;

                if (result.Outcome != QrScanOutcome.Decoded)
                    return; // NotFound or Error: nothing to validate yet, keep scanning.

                PairingCodeValidation validation = PairingCodeValidator.Validate(result.RawPayload);
                if (!validation.IsValid)
                {
                    onRejected?.Invoke(validation.Reason.Value);
                    return; // A bad candidate does not stop the attempt — see the class doc.
                }

                _settled = true;
                _pending.Set(validation.Code);
                _scanner.StopScanning();
                onCodeReady(validation.Code);
            });
        }

        /// <summary>Ends scanning without a code having been found. Safe to call at any time.</summary>
        public void Stop()
        {
            _settled = true;
            _scanner.StopScanning();
        }

        /// <summary>
        /// Advances this receiver's timeout clock by <paramref name="deltaSeconds"/>. A real
        /// caller (a MonoBehaviour) calls this once per frame with <c>Time.deltaTime</c> while
        /// scanning is active; nothing here reads the engine's clock itself, so a test can call
        /// this directly with any value and see deterministic behaviour without waiting on real
        /// time.
        /// </summary>
        /// <remarks>
        /// Does nothing once this receiver has already settled (a code was found, it was stopped,
        /// or it already timed out), and does nothing if <see cref="Start"/> was not given a
        /// <c>timeoutSeconds</c>. Fires <c>onTimeout</c> at most once, the same
        /// stop-scanning-and-settle sequence a found code goes through — a receiver that has timed
        /// out cannot later report a code, even if <see cref="Tick"/> keeps being called.
        /// </remarks>
        public void Tick(float deltaSeconds)
        {
            if (_settled || _timeoutSeconds == null) return;

            _elapsedSeconds += deltaSeconds;
            if (_elapsedSeconds < _timeoutSeconds.Value) return;

            _settled = true;
            _scanner.StopScanning();
            _onTimeout?.Invoke();
        }
    }
}
