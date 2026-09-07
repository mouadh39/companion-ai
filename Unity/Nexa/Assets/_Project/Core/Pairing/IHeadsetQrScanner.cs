using System;

namespace Nexa.Core.Pairing
{
    /// <summary>What one scan attempt found, or why it found nothing.</summary>
    public enum QrScanOutcome
    {
        /// A QR symbol was decoded from the frame. <see cref="QrScanResult.RawPayload"/> is set.
        Decoded,

        /// The frame carried no readable QR symbol — not a failure, just nothing there yet.
        /// A scanning session normally reports many of these before one <see cref="Decoded"/>.
        NotFound,

        /// The scanner itself could not process a frame — camera failure, decode exception, or
        /// the scanning session timing out with nothing found. Distinguished from
        /// <see cref="NotFound"/> because the right response differs: a caller may want to
        /// surface this to a person, where an ordinary <see cref="NotFound"/> is silent.
        Error,
    }

    /// <summary>
    /// One scan attempt's outcome. Deliberately carries only what every possible
    /// <see cref="IHeadsetQrScanner"/> implementation can honestly report — no confidence score,
    /// no bounding box, nothing tied to a particular decoder's own feature set.
    /// </summary>
    public readonly struct QrScanResult
    {
        public QrScanResult(QrScanOutcome outcome, string rawPayload = null, string errorMessage = null)
        {
            Outcome = outcome;
            RawPayload = rawPayload;
            ErrorMessage = errorMessage;
        }

        public QrScanOutcome Outcome { get; }

        /// <summary>
        /// The exact text decoded from the QR symbol — meaningful only when
        /// <see cref="Outcome"/> is <see cref="QrScanOutcome.Decoded"/>. This is the raw text a
        /// QR symbol carried, entirely untrusted: it is not yet known to be an NX2 pairing code,
        /// or anything else this app should act on — see <c>Nexa.Pairing.PairingCodeValidator</c>,
        /// the deliberate, separate next step that decides that.
        /// </summary>
        public string RawPayload { get; }

        /// <summary>Diagnostic only, meaningful when <see cref="Outcome"/> is <see cref="QrScanOutcome.Error"/>.</summary>
        public string ErrorMessage { get; }

        public static QrScanResult Decoded(string rawPayload) => new QrScanResult(QrScanOutcome.Decoded, rawPayload: rawPayload);
        public static QrScanResult NotFound() => new QrScanResult(QrScanOutcome.NotFound);
        public static QrScanResult Error(string message) => new QrScanResult(QrScanOutcome.Error, errorMessage: message);

        /// <summary>
        /// Deliberately never includes <see cref="RawPayload"/> — a scanned QR payload is
        /// untrusted input, not yet validated as anything this app should trust, and must not be
        /// visible in a log or debugger the way this method's output can be. See
        /// <c>Nexa.Pairing.PendingPairingCode</c> for the same rule applied to a payload that
        /// *has* since been validated.
        /// </summary>
        public override string ToString() =>
            $"QrScanResult(outcome: {Outcome}, hasPayload: {RawPayload != null})";
    }

    /// <summary>
    /// Decodes QR symbols from whatever camera source a concrete implementation owns, and
    /// reports each attempt as it happens.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the entire boundary between "a camera exists" and "this app has a candidate
    /// string" — deliberately narrow. It says nothing about which camera API, which decoding
    /// library, or which platform a concrete implementation uses; a Quest build, an Android
    /// phone build, and an in-memory test double are all just implementations of this one
    /// contract. It never validates what it decodes as an NX2 pairing code, never signs
    /// anything, never touches the network, and never touches <c>IHeadsetIdentity</c> — see
    /// the report on why those stay separate.
    /// </para>
    /// <para>
    /// Callback-based, matching this project's own established shape
    /// (<c>ICompanionBackend.Send</c>) rather than a single request/response: a camera is a
    /// continuous source, not a one-shot call, and a scanning session is expected to report many
    /// <see cref="QrScanOutcome.NotFound"/> results before one <see cref="QrScanOutcome.Decoded"/>
    /// — or a caller-driven <see cref="StopScanning"/> — ends it.
    /// </para>
    /// </remarks>
    public interface IHeadsetQrScanner
    {
        bool IsScanning { get; }

        /// <summary>
        /// Begins scanning. <paramref name="onResult"/> is invoked once per frame this scanner
        /// actually processes, for as long as scanning continues — never after
        /// <see cref="StopScanning"/> has been called.
        /// </summary>
        void StartScanning(Action<QrScanResult> onResult);

        /// <summary>Ends scanning. Safe to call whether or not scanning is currently active.</summary>
        void StopScanning();
    }
}
