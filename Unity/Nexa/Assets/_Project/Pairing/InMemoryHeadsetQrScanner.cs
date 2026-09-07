using System;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// A deterministic, in-memory <see cref="IHeadsetQrScanner"/> for tests — no camera, no
    /// image decoding, no platform dependency of any kind.
    /// </summary>
    /// <remarks>
    /// This is the seam a real camera-backed scanner plugs into later, and exactly what this
    /// codebase uses in place of one today — see the report on why a real Quest camera adapter
    /// is not implemented in this step. <see cref="EmitFrame"/> lets a test simulate exactly one
    /// camera frame's outcome at a time, driving <see cref="HeadsetPairingCodeReceiver"/> (or any
    /// other <see cref="IHeadsetQrScanner"/> consumer) through the same sequence of
    /// <see cref="QrScanResult"/> values a real camera loop would eventually deliver.
    /// </remarks>
    public sealed class InMemoryHeadsetQrScanner : IHeadsetQrScanner
    {
        Action<QrScanResult> _onResult;

        public bool IsScanning { get; private set; }

        /// <summary>How many times <see cref="StartScanning"/> has been called, in total — lets a
        /// test confirm scanning did or did not restart after a result.</summary>
        public int StartCount { get; private set; }

        public void StartScanning(Action<QrScanResult> onResult)
        {
            _onResult = onResult ?? throw new ArgumentNullException(nameof(onResult));
            IsScanning = true;
            StartCount++;
        }

        public void StopScanning()
        {
            IsScanning = false;
            _onResult = null;
        }

        /// <summary>
        /// Delivers one scan result to whatever callback <see cref="StartScanning"/> was given —
        /// exactly what a real scanner does once per processed camera frame. Does nothing if not
        /// currently scanning, the same way a real scanner could not deliver a frame after being
        /// stopped.
        /// </summary>
        public void EmitFrame(QrScanResult result)
        {
            if (!IsScanning) return;
            _onResult?.Invoke(result);
        }

        /// <summary>
        /// Delivers a result even if scanning has already stopped — exists only to test that a
        /// consumer (<see cref="HeadsetPairingCodeReceiver"/>) tolerates a stray late callback
        /// rather than assuming a real scanner can never produce one after <c>StopScanning</c>.
        /// </summary>
        public void ForceEmitFrame(QrScanResult result) => _onResult?.Invoke(result);
    }
}
