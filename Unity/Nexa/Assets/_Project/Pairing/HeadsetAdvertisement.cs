using System;
using System.Globalization;
using UnityEngine;

namespace Nexa.Pairing
{
    /// <summary>
    /// The one message this headset sends over the local transport while in pairing mode — the
    /// C#/Unity counterpart to <c>apps/flutter-client</c>'s <c>HeadsetAdvertisement</c>, and the
    /// same deliberately minimal protocol that class's own doc describes: no handshake, no
    /// acknowledgement, no session state on the wire, just enough for a nearby phone to notice
    /// this headset and learn its enrolment handle.
    /// </summary>
    /// <remarks>
    /// This type does not obtain an enrolment handle itself — nothing in this codebase calls
    /// <c>POST /v1/device-enrolments</c> yet (no Unity backend/HTTP client exists at all as of
    /// this step; see the report). <see cref="Encode"/> takes one as a plain, required argument,
    /// the same seam <c>PairingSessionRepository.createPairingSession</c> documents on the Dart
    /// side for the equivalent reason: the caller that eventually enrols this headset supplies the
    /// handle here, and this class does not guess at how that happens.
    /// </remarks>
    public readonly struct HeadsetAdvertisement
    {
        public HeadsetAdvertisement(string deviceName, string enrolmentHandle, DateTime issuedAtUtc)
        {
            DeviceName = deviceName;
            EnrolmentHandle = enrolmentHandle;
            IssuedAtUtc = issuedAtUtc;
        }

        /// <summary>What this headset calls itself — e.g. "Meta Quest 3". Never trusted as proof of anything.</summary>
        public string DeviceName { get; }

        /// <summary>
        /// The plaintext handle from <c>POST /v1/device-enrolments</c> — see the class doc on why
        /// obtaining one is out of scope here. Exactly as sensitive as it is anywhere else in this
        /// codebase's own pairing work; see <c>PendingPairingCode</c>'s doc for the same standard
        /// applied to a different secret.
        /// </summary>
        public string EnrolmentHandle { get; }

        /// <summary>When this advertisement was minted — lets a receiver prefer a fresher repeat over a stale one.</summary>
        public DateTime IssuedAtUtc { get; }

        /// <summary>Deliberately never includes <see cref="EnrolmentHandle"/>.</summary>
        public override string ToString() =>
            $"HeadsetAdvertisement(deviceName: {DeviceName}, issuedAtUtc: {IssuedAtUtc:o})";
    }

    /// <summary>
    /// Unity's own flat, <c>[Serializable]</c> mirror of the JSON wire shape
    /// <c>HeadsetAdvertisementCodec</c> reads and writes — required because
    /// <see cref="UnityEngine.JsonUtility"/> serialises fixed fields on a concrete type, not an
    /// arbitrary map the way <c>dart:convert</c>'s <c>jsonEncode</c>/<c>jsonDecode</c> do. Every
    /// field here is a top-level key in the JSON object on the wire, magic and type included —
    /// there is no separate "envelope" object nested inside; that flatness matches exactly what
    /// the Dart side actually produces (see that side's own <c>encode</c>, which spreads a
    /// payload's fields alongside <c>magic</c> and <c>type</c> in one object, not nested under a
    /// key).
    /// </summary>
    [Serializable]
    sealed class HeadsetAdvertisementWireModel
    {
        public string magic;
        public string type;
        public string deviceName;
        public string enrolmentHandle;
        public string issuedAt;
    }

    /// <summary>
    /// Turns a <see cref="HeadsetAdvertisement"/> into wire bytes and back — the C#/Unity
    /// counterpart to <c>apps/flutter-client</c>'s <c>HeadsetAdvertisementCodec</c>, using exactly
    /// the same wire shape.
    /// </summary>
    /// <remarks>
    /// <para>
    /// ## The one thing this class cannot verify about itself
    /// </para>
    /// <para>
    /// <see cref="UnityEngine.JsonUtility"/>'s exact behaviour on malformed or partial JSON input
    /// cannot be confirmed without a Unity Editor, which this environment does not have (see the
    /// report). Unity's own documentation is not fully explicit about every failure mode — some
    /// malformed input is documented to throw, but a subtly wrong shape (the right keys, wrong
    /// types; extra unknown keys; a truncated object) is not guaranteed to throw at all and could
    /// instead hand back a partially-populated object with null or default fields. <see cref="Decode"/>
    /// is written defensively against exactly that possibility: it never trusts a successful parse
    /// alone, and separately validates every field it actually needs is present and non-empty
    /// before returning anything. A real Quest build is the only way to confirm this defensive
    /// coding was actually necessary, or sufficient.
    /// </para>
    /// </remarks>
    public static class HeadsetAdvertisementCodec
    {
        public static string Encode(HeadsetAdvertisement advertisement)
        {
            var model = new HeadsetAdvertisementWireModel
            {
                magic = PairingLanEnvelope.Magic,
                type = "advertisement",
                deviceName = advertisement.DeviceName,
                enrolmentHandle = advertisement.EnrolmentHandle,
                issuedAt = advertisement.IssuedAtUtc.ToString("o", CultureInfo.InvariantCulture),
            };
            return JsonUtility.ToJson(model);
        }

        /// <summary>
        /// Returns <c>false</c> for absolutely anything this cannot confidently read as a genuine
        /// advertisement — see the class doc on why this defends against more than just "invalid
        /// JSON." Never throws.
        /// </summary>
        public static bool TryDecode(string raw, out HeadsetAdvertisement advertisement)
        {
            advertisement = default;

            if (!PairingLanEnvelope.IsPlausibleSize(raw)) return false;

            HeadsetAdvertisementWireModel model;
            try
            {
                model = JsonUtility.FromJson<HeadsetAdvertisementWireModel>(raw);
            }
            catch (Exception)
            {
                // Whatever UnityEngine.JsonUtility's exact exception type is for this input —
                // see the class doc — every one of them means the same thing here: not decodable.
                return false;
            }

            if (model == null) return false;
            if (model.magic != PairingLanEnvelope.Magic) return false;
            if (!PairingLanEnvelope.IsRecognizedType(model.type)) return false;

            string effectiveType = string.IsNullOrEmpty(model.type) ? "advertisement" : model.type;
            if (effectiveType != "advertisement") return false; // recognised by the envelope, but not this codec's own type — see HeadsetAdvertisementCodec.dart's identical routing check

            if (string.IsNullOrEmpty(model.deviceName)) return false;
            if (string.IsNullOrEmpty(model.enrolmentHandle)) return false;
            if (string.IsNullOrEmpty(model.issuedAt)) return false;

            DateTime issuedAtUtc;
            if (!DateTime.TryParse(
                    model.issuedAt,
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                    out issuedAtUtc))
            {
                return false;
            }

            advertisement = new HeadsetAdvertisement(model.deviceName, model.enrolmentHandle, issuedAtUtc);
            return true;
        }
    }
}
