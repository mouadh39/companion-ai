using Nexa.Data.Companion;
using UnityEngine;

namespace Nexa.Character
{
    /// <summary>
    /// Applies a subtle breathing bob so the companion is never perfectly still.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A character that holds an exact pose reads instantly as an object rather than a being. This
    /// is the cheapest available signal of life and matters most before a real rig exists, since a
    /// placeholder has no idle animation at all.
    /// </para>
    /// <para>
    /// The offset is applied to a dedicated visual child, never to the companion root. The root
    /// carries the logical ground position that locomotion and placement reason about; letting a
    /// cosmetic effect write to it would feed the bob back into ground adherence and compound.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class CompanionIdleMotion : MonoBehaviour
    {
        [Tooltip("Visual child to offset. Must not be the companion root.")]
        [SerializeField] Transform _visualRoot;

        CompanionPresenceConfig _config;
        Vector3 _restLocalPosition;
        float _phase;

        public void Initialize(CompanionPresenceConfig config)
        {
            _config = config;

            if (_visualRoot == null)
                return;

            _restLocalPosition = _visualRoot.localPosition;

            // A shared start phase would make every companion in a future multi-character scene
            // breathe in perfect unison, which reads as mechanical.
            _phase = Random.value * Mathf.PI * 2f;
        }

        public void Tick(float deltaTime)
        {
            if (_config == null || _visualRoot == null)
                return;

            _phase += deltaTime * _config.BreathFrequency * Mathf.PI * 2f;

            Vector3 local = _restLocalPosition;
            local.y += Mathf.Sin(_phase) * _config.BreathAmplitude;
            _visualRoot.localPosition = local;
        }
    }
}
