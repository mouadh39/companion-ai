using System;
using UnityEngine;

namespace Nexa.Pairing
{
    /// <summary>
    /// The phone's reply carrying <c>pairingSessionId</c> — the C#/Unity counterpart to
    /// <c>apps/flutter-client</c>'s <c>PairingContextMessage</c>. See that class's own doc for the
    /// full reasoning on why a headset cannot learn this value from the QR code alone.
    /// </summary>
    public readonly struct PairingContextMessage
    {
        public PairingContextMessage(string pairingSessionId)
        {
            PairingSessionId = pairingSessionId;
        }

        public string PairingSessionId { get; }
    }

    [Serializable]
    sealed class PairingContextWireModel
    {
        public string magic;
        public string type;
        public string pairingSessionId;
    }

    /// <summary>
    /// Turns a <see cref="PairingContextMessage"/> into wire bytes and back — the C#/Unity
    /// counterpart to <c>apps/flutter-client</c>'s <c>PairingContextCodec</c>, following the same
    /// envelope-then-per-type pattern <see cref="HeadsetAdvertisementCodec"/> already does. See
    /// that class's own doc for why <see cref="UnityEngine.JsonUtility"/>'s exact malformed-input
    /// behaviour cannot be verified in this environment, and why <see cref="TryDecode"/> defends
    /// against that beyond just catching exceptions.
    /// </summary>
    public static class PairingContextCodec
    {
        public static string Encode(PairingContextMessage message)
        {
            var model = new PairingContextWireModel
            {
                magic = PairingLanEnvelope.Magic,
                type = "pairing_context",
                pairingSessionId = message.PairingSessionId,
            };
            return JsonUtility.ToJson(model);
        }

        public static bool TryDecode(string raw, out PairingContextMessage message)
        {
            message = default;

            if (!PairingLanEnvelope.IsPlausibleSize(raw)) return false;

            PairingContextWireModel model;
            try
            {
                model = JsonUtility.FromJson<PairingContextWireModel>(raw);
            }
            catch (Exception)
            {
                return false;
            }

            if (model == null) return false;
            if (model.magic != PairingLanEnvelope.Magic) return false;
            if (!PairingLanEnvelope.IsRecognizedType(model.type)) return false;

            string effectiveType = string.IsNullOrEmpty(model.type) ? "advertisement" : model.type;
            if (effectiveType != "pairing_context") return false; // recognised by the envelope, but not this codec's own type

            if (string.IsNullOrEmpty(model.pairingSessionId)) return false;

            message = new PairingContextMessage(model.pairingSessionId);
            return true;
        }
    }
}
