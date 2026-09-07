using UnityEngine;

namespace Nexa.Data.Backend
{
    /// <summary>
    /// Where the Nexa backend's device-pairing routes are — specifically
    /// <c>POST /v1/pairing-sessions/redeem</c>. The pairing-side sibling of
    /// <see cref="CompanionBackendConfig"/>, kept as its own asset rather than a shared one because
    /// the two configure genuinely different concerns with different lifetimes: a companion turn
    /// needs a <c>companionId</c> and a <c>userId</c> this headset does not have and must not
    /// invent before it has even paired, while redemption needs neither — it is unauthenticated by
    /// the backend's own design (see <c>apps/backend/src/server.ts</c>'s own doc on
    /// <c>/v1/pairing-sessions/redeem</c>).
    /// </summary>
    /// <remarks>
    /// Both configs point at the same physical backend deployment in practice, and both would need
    /// updating together if that address ever changes — that duplication is accepted here the same
    /// way it already is between <see cref="CompanionBackendConfig"/>'s own <c>TurnUrl</c> and
    /// <c>ActionResultUrl</c> being derived from one shared <c>_baseUrl</c> rather than configured
    /// separately: the field that could drift is the one thing kept single within each asset, and
    /// the base URL, not the field, is what a deployment operator would update in either place.
    /// </remarks>
    [CreateAssetMenu(
        fileName = "DevicePairingBackendConfig",
        menuName = "Nexa/Backend/Device Pairing Backend Config",
        order = 1)]
    public sealed class DevicePairingBackendConfig : ScriptableObject
    {
        [Header("Endpoint")]
        [Tooltip("Root address of the Nexa backend, without a trailing slash — the same deployment "
                 + "CompanionBackendConfig points at.")]
        [SerializeField] string _baseUrl = "http://127.0.0.1:3000";

        [Tooltip("How long to wait for a redemption attempt, in seconds. Deliberately shorter than a "
                 + "cognitive turn's own timeout — a redemption is a single signature verification "
                 + "and a few database writes, not a model call.")]
        [SerializeField, Range(5, 60)] int _timeoutSeconds = 20;

        public string BaseUrl => _baseUrl;
        public int TimeoutSeconds => _timeoutSeconds;

        /// <summary>The address a redemption request is posted to.</summary>
        public string RedeemUrl => $"{_baseUrl.TrimEnd('/')}/v1/pairing-sessions/redeem";

        /// <summary>True when every field needed to reach the backend has been filled in.</summary>
        public bool IsComplete => !string.IsNullOrWhiteSpace(_baseUrl);

        void OnValidate()
        {
            // Trimmed here rather than at the call site — see CompanionBackendConfig's own
            // identical guard for the same reason.
            if (_baseUrl != null)
                _baseUrl = _baseUrl.Trim();
        }
    }
}
