using System;
using System.Text;
using Nexa.Core.Identity;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// The entire headset-side pairing pipeline, start to finish: QR scanning (3F-H),
    /// local-transport pairing context (3F-J), challenge signing (3F-I), and now — the piece that
    /// closes the loop — the actual redemption call and credential persistence. By the time
    /// <c>onPaired</c> fires, this headset genuinely holds backend-issued device credentials; not a
    /// moment sooner.
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
    /// Composing all five pieces here, rather than leaving a caller (a future scene controller) to
    /// sequence them correctly itself, is the same "one domain operation, one owner" reasoning
    /// <see cref="HeadsetPairingCodeReceiver"/>'s own doc gives for composing its own three
    /// dependencies. This class adds no cryptography, no validation, no networking logic, and no
    /// encryption of its own — every one of those still belongs to the class that already owns it
    /// (<see cref="HeadsetPairingRedemptionRequestBuilder"/>, <see cref="IHeadsetPairingRedemptionClient"/>,
    /// <see cref="IHeadsetCredentialStore"/> respectively). This class only sequences them.
    /// </para>
    /// <para>
    /// ## What "paired" means here, precisely
    /// </para>
    /// <para>
    /// <c>onPaired</c> fires once, and only once <see cref="IHeadsetPairingRedemptionClient"/> has
    /// reported <see cref="PairingRedemptionOutcomeKind.Succeeded"/> — which itself only happens
    /// once the backend's own response has been read and validated as a genuine credential (see
    /// <c>PairingRedemptionResponseInterpreter</c>'s own doc). Scanning a QR code, receiving a LAN
    /// message, and even successfully sending the redemption request are none of them "paired" on
    /// their own; this class has no code path that treats any of them as sufficient.
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
        readonly IHeadsetPairingRedemptionClient _redemptionClient;
        readonly IHeadsetCredentialStore _credentialStore;

        bool _settled;
        bool _stopped;
        string _pendingCode;
        string _pendingPairingSessionId;
        Action<DeviceCredentials> _onPaired;
        Action<PairingRedemptionOutcome> _onRedemptionFailed;
        Action<Exception> _onBuildError;

        public HeadsetPairingCoordinator(
            IHeadsetIdentity identity,
            HeadsetPairingCodeReceiver codeReceiver,
            IHeadsetLanSocket lanSocket,
            IHeadsetPairingRedemptionClient redemptionClient,
            IHeadsetCredentialStore credentialStore)
        {
            _identity = identity ?? throw new ArgumentNullException(nameof(identity));
            _codeReceiver = codeReceiver ?? throw new ArgumentNullException(nameof(codeReceiver));
            _lanSocket = lanSocket ?? throw new ArgumentNullException(nameof(lanSocket));
            _redemptionClient = redemptionClient ?? throw new ArgumentNullException(nameof(redemptionClient));
            _credentialStore = credentialStore ?? throw new ArgumentNullException(nameof(credentialStore));
        }

        /// <summary>
        /// Begins both waits at once: scanning for a QR code, and listening for a
        /// <c>pairing_context</c> message. Once both are in hand, builds and sends the redemption
        /// request automatically — no further call is needed to complete pairing.
        /// </summary>
        /// <param name="onPaired">
        /// Invoked exactly once, with genuine backend-issued credentials already saved to
        /// <see cref="IHeadsetCredentialStore"/>, once redemption actually succeeds. See the class
        /// doc on why nothing earlier than this ever calls it.
        /// </param>
        /// <param name="onRedemptionFailed">
        /// Invoked exactly once instead of <paramref name="onPaired"/> if the redemption attempt
        /// itself does not succeed — a rejection, a rate limit, an unreachable backend, or a
        /// malformed response; see <see cref="PairingRedemptionOutcome"/>'s own doc on what each
        /// means for whether trying again is safe. This class never retries on a caller's behalf.
        /// </param>
        /// <param name="onBuildError">
        /// Invoked instead of either of the above if building the request itself fails (e.g. the
        /// identity has no key yet — see <see cref="HeadsetPairingRedemptionRequestBuilder.Build"/>'s
        /// own exceptions). If omitted, the exception is thrown back out through whichever
        /// dependency's callback was in progress when the second fact arrived (the scanner's or the
        /// socket's) — a build failure must never be silently swallowed, but this class has no
        /// dispatcher of its own to catch it more gracefully than that.
        /// </param>
        public void Start(
            Action<DeviceCredentials> onPaired,
            Action<PairingRedemptionOutcome> onRedemptionFailed,
            Action<Exception> onBuildError = null)
        {
            if (onPaired == null) throw new ArgumentNullException(nameof(onPaired));
            if (onRedemptionFailed == null) throw new ArgumentNullException(nameof(onRedemptionFailed));

            _settled = false;
            _stopped = false;
            _pendingCode = null;
            _pendingPairingSessionId = null;
            _onPaired = onPaired;
            _onRedemptionFailed = onRedemptionFailed;
            _onBuildError = onBuildError;

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
                if (_onBuildError != null) _onBuildError(exception);
                else throw;
                return;
            }

            // The one and only place this class calls out over the network — everything above is
            // pure local sequencing. See IHeadsetPairingRedemptionClient's own doc on why this call
            // is never retried automatically by anything downstream of it either.
            _redemptionClient.Redeem(request.Code, request.SignatureBase64, HandleRedemptionOutcome);
        }

        void HandleRedemptionOutcome(PairingRedemptionOutcome outcome)
        {
            // Stop() may have been called after the redemption request was already dispatched —
            // an in-flight HTTP call cannot be cancelled from here, but its eventual result must
            // never reach a caller that already asked this coordinator to stop.
            if (_stopped) return;

            if (outcome.Kind != PairingRedemptionOutcomeKind.Succeeded)
            {
                _onRedemptionFailed(outcome);
                return;
            }

            // outcome.Credentials is guaranteed non-null here — see PairingRedemptionOutcome.Succeeded's own doc.
            DeviceCredentials credentials = outcome.Credentials.Value;

            // Persisted before the caller is ever told pairing succeeded — a process that died
            // between the two would rather rediscover "not actually paired" on next launch (no
            // credentials were saved) than believe it is paired while holding nothing to prove it.
            _credentialStore.Save(credentials);
            _onPaired(credentials);
        }

        /// <summary>
        /// Ends both waits, and suppresses the result of a redemption call already in flight if one
        /// was. Safe to call at any time.
        /// </summary>
        public void Stop()
        {
            _settled = true;
            _stopped = true;
            _codeReceiver.Stop();
            _lanSocket.StopReceiving();
        }
    }
}
