using System;
using System.Text;
using Nexa.Core.Identity;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// Ties this step's three separate pieces — QR scanning (3F-H), local-transport pairing
    /// context (3F-J), and challenge signing (3F-I) — into the one thing a headset actually needs:
    /// a ready-to-send <see cref="PairingRedemptionRequest"/>. Still does not send it.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A headset needs two facts before it can build a valid redemption request — a validated
    /// NX2 code (from <see cref="HeadsetPairingCodeReceiver"/>) and the <c>pairingSessionId</c>
    /// bound to it (from a <see cref="PairingContextMessage"/> received over
    /// <see cref="IHeadsetLanSocket"/>) — and nothing about this codebase's own protocol guarantees
    /// which arrives first: a phone could send its LAN reply before or after the headset's camera
    /// actually reads the QR code being displayed. This class holds whichever fact arrives first
    /// and waits for the other, rather than assuming an order neither 3F-H nor 3F-J's own design
    /// promises.
    /// </para>
    /// <para>
    /// Composing all three pieces here, rather than leaving a caller (a future scene controller) to
    /// sequence them correctly itself, is the same "one domain operation, one owner" reasoning
    /// <see cref="HeadsetPairingCodeReceiver"/>'s own doc gives for composing its own three
    /// dependencies. This class adds no cryptography, no validation, and no networking of its own —
    /// every one of those still belongs to the class that already owns it.
    /// </para>
    /// <para>
    /// Once both facts are in hand, this settles permanently: neither a further QR read nor a
    /// further LAN message can change the request already produced, or produce a second one. A
    /// caller that wants to try again after <see cref="Stop"/> or a completed attempt calls
    /// <see cref="Start"/> again, the same restart pattern <see cref="HeadsetPairingCodeReceiver"/>
    /// already establishes.
    /// </para>
    /// </remarks>
    public sealed class HeadsetPairingCoordinator
    {
        readonly IHeadsetIdentity _identity;
        readonly HeadsetPairingCodeReceiver _codeReceiver;
        readonly IHeadsetLanSocket _lanSocket;

        bool _settled;
        string _pendingCode;
        string _pendingPairingSessionId;
        Action<PairingRedemptionRequest> _onReady;
        Action<Exception> _onError;

        public HeadsetPairingCoordinator(
            IHeadsetIdentity identity,
            HeadsetPairingCodeReceiver codeReceiver,
            IHeadsetLanSocket lanSocket)
        {
            _identity = identity ?? throw new ArgumentNullException(nameof(identity));
            _codeReceiver = codeReceiver ?? throw new ArgumentNullException(nameof(codeReceiver));
            _lanSocket = lanSocket ?? throw new ArgumentNullException(nameof(lanSocket));
        }

        /// <summary>
        /// Begins both waits at once: scanning for a QR code, and listening for a
        /// <c>pairing_context</c> message. <paramref name="onReady"/> is invoked exactly once, with
        /// a signed request, once both facts are in hand. <paramref name="onError"/>, if given, is
        /// invoked instead if building the request itself fails (e.g. the identity has no key yet —
        /// see <see cref="HeadsetPairingRedemptionRequestBuilder.Build"/>'s own exceptions). If
        /// <paramref name="onError"/> is omitted, the exception is thrown back out through whichever
        /// dependency's callback was in progress when the second fact arrived (the scanner's or the
        /// socket's) — a build failure must never be silently swallowed, but this class has no
        /// dispatcher of its own to catch it more gracefully than that.
        /// </summary>
        public void Start(Action<PairingRedemptionRequest> onReady, Action<Exception> onError = null)
        {
            if (onReady == null) throw new ArgumentNullException(nameof(onReady));

            _settled = false;
            _pendingCode = null;
            _pendingPairingSessionId = null;
            _onReady = onReady;
            _onError = onError;

            _codeReceiver.Start(code =>
            {
                _pendingCode = code;
                TryComplete();
            });

            _lanSocket.StartReceiving(datagram =>
            {
                if (_settled) return;

                string text;
                try
                {
                    text = Encoding.UTF8.GetString(datagram.Payload);
                }
                catch (Exception)
                {
                    return; // not even valid UTF-8 — hostile or corrupt, ignored like any other bad frame
                }

                if (!PairingContextCodec.TryDecode(text, out PairingContextMessage context))
                    return; // not a pairing_context message — e.g. an advertisement, or noise; keep listening

                _pendingPairingSessionId = context.PairingSessionId;
                TryComplete();
            });
        }

        void TryComplete()
        {
            if (_settled) return;
            if (_pendingCode == null || _pendingPairingSessionId == null) return;

            _settled = true;
            _codeReceiver.Stop();
            _lanSocket.StopReceiving();

            PairingRedemptionRequest request;
            try
            {
                request = HeadsetPairingRedemptionRequestBuilder.Build(_identity, _pendingPairingSessionId, _pendingCode);
            }
            catch (Exception exception)
            {
                if (_onError != null) _onError(exception);
                else throw;
                return;
            }

            _onReady(request);
        }

        /// <summary>Ends both waits without a request having been produced. Safe to call at any time.</summary>
        public void Stop()
        {
            _settled = true;
            _codeReceiver.Stop();
            _lanSocket.StopReceiving();
        }
    }
}
