using System;
using System.Collections.Generic;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// A deterministic, in-memory <see cref="IHeadsetPairingRedemptionClient"/> for tests — no real
    /// HTTP call, no platform dependency, and the exact shape a test needs to prove a caller sent
    /// only <c>code</c> and <c>signatureBase64</c> and nothing else.
    /// </summary>
    public sealed class InMemoryHeadsetPairingRedemptionClient : IHeadsetPairingRedemptionClient
    {
        /// <summary>One recorded call to <see cref="Redeem"/>.</summary>
        public readonly struct RecordedCall
        {
            public RecordedCall(string code, string signatureBase64)
            {
                Code = code;
                SignatureBase64 = signatureBase64;
            }

            public string Code { get; }
            public string SignatureBase64 { get; }
        }

        /// <summary>Every call this instance has received, in order.</summary>
        public List<RecordedCall> Calls { get; } = new List<RecordedCall>();

        /// <summary>
        /// What the next (and every subsequent, unless changed again) call to <see cref="Redeem"/>
        /// reports. Defaults to a generic rejection, so a test that forgets to configure this fails
        /// loudly rather than silently succeeding.
        /// </summary>
        public PairingRedemptionOutcome NextOutcome { get; set; } =
            PairingRedemptionOutcome.Rejected("InMemoryHeadsetPairingRedemptionClient.NextOutcome was never configured.");

        /// <summary>
        /// Whether to invoke <c>onResult</c> synchronously (the default) or hold it for
        /// <see cref="CompletePending"/> to invoke later — for a test proving a caller does not
        /// assume the callback fires before <c>Redeem</c> itself returns.
        /// </summary>
        public bool DeliverSynchronously { get; set; } = true;

        Action<PairingRedemptionOutcome> _pendingCallback;

        public void Redeem(string code, string signatureBase64, Action<PairingRedemptionOutcome> onResult)
        {
            if (onResult == null) throw new ArgumentNullException(nameof(onResult));

            Calls.Add(new RecordedCall(code, signatureBase64));

            if (DeliverSynchronously)
            {
                onResult(NextOutcome);
            }
            else
            {
                _pendingCallback = onResult;
            }
        }

        /// <summary>Invokes whatever callback <see cref="Redeem"/> most recently withheld. No-op if none is pending.</summary>
        public void CompletePending()
        {
            Action<PairingRedemptionOutcome> callback = _pendingCallback;
            _pendingCallback = null;
            callback?.Invoke(NextOutcome);
        }
    }
}
