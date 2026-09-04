using System.Collections.Generic;

namespace Nexa.Pairing
{
    /// <summary>
    /// The cheap, envelope-level guards every message on Nexa's local pairing transport passes
    /// through before any per-message-type parsing runs — the C#/Unity counterpart to
    /// <c>PairingLanEnvelope</c> in <c>apps/flutter-client</c>, and deliberately the same shape of
    /// checks, so both ends of this wire agree on what counts as "not even worth parsing further."
    /// </summary>
    /// <remarks>
    /// <para>
    /// Unlike the Dart side, this class does not decode JSON into a generic map — Unity's built-in
    /// <c>UnityEngine.JsonUtility</c> deserialises straight into a fixed, flat C# type per message
    /// (see <c>HeadsetAdvertisementCodec</c>), so there is no intermediate "envelope as a
    /// dictionary" step to have here. This class instead holds the constants and the two checks
    /// that are cheap to run before touching JSON at all — size, and the empty-string case — and a
    /// shared type-allowlist check every per-type codec calls with whatever <c>type</c> field it
    /// actually parsed out. Splitting it this way, rather than duplicating <c>Magic</c> and
    /// <c>MaxEncodedChars</c> inside every codec, is the same "one place to get it right" reasoning
    /// this codebase applies everywhere else.
    /// </para>
    /// <para>
    /// The wire format itself — <c>magic</c>, <c>type</c>, <c>maxEncodedChars</c> — is fixed by
    /// the Dart side (see that class's own doc); nothing here invents a second protocol.
    /// </para>
    /// </remarks>
    public static class PairingLanEnvelope
    {
        /// <summary>Must match <c>apps/flutter-client</c>'s <c>PairingLanEnvelope.magic</c> exactly.</summary>
        public const string Magic = "nexa.pairing.v1";

        /// <summary>Must match <c>apps/flutter-client</c>'s <c>PairingLanEnvelope.maxEncodedChars</c> exactly.</summary>
        public const int MaxEncodedChars = 4096;

        static readonly HashSet<string> SupportedTypes = new HashSet<string> { "advertisement", "pairing_context" };

        /// <summary>
        /// The cheapest possible rejection, before any JSON parsing runs at all: empty, or larger
        /// than any genuine message could plausibly be.
        /// </summary>
        public static bool IsPlausibleSize(string raw) =>
            !string.IsNullOrEmpty(raw) && raw.Length <= MaxEncodedChars;

        /// <summary>
        /// Whether <paramref name="type"/> is one this build knows how to route — an empty or
        /// null value is treated as <c>"advertisement"</c>, the only type that predates this field
        /// existing, exactly as the Dart side documents for the same backward-compatibility
        /// reason.
        /// </summary>
        public static bool IsRecognizedType(string type)
        {
            string effective = string.IsNullOrEmpty(type) ? "advertisement" : type;
            return SupportedTypes.Contains(effective);
        }
    }
}
