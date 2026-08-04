using UnityEngine;

namespace Nexa.Data.Companion
{
    /// <summary>
    /// Tuning for the signals that make the companion read as alive rather than as a prop:
    /// where it looks, and how it idles.
    /// </summary>
    [CreateAssetMenu(
        fileName = "CompanionPresenceConfig",
        menuName = "Nexa/Companion/Presence Config",
        order = 1)]
    public sealed class CompanionPresenceConfig : ScriptableObject
    {
        [Header("Gaze")]
        [Tooltip("How fast the body turns to face the user, in degrees per second.")]
        [SerializeField, Range(10f, 720f)] float _bodyTurnSpeed = 180f;

        [Tooltip("The companion ignores yaw error below this angle. Without a deadzone it micro-" +
                 "corrects against natural hand tremor and looks nervous.")]
        [SerializeField, Range(0f, 45f)] float _gazeDeadzoneAngle = 8f;

        [Header("Arrival")]
        [Tooltip("How far from facing the user the companion is spawned, in degrees. Non-zero on " +
                 "purpose: the companion must be seen turning toward the user rather than appearing " +
                 "already staring at them. Set to 0 to arrive pre-aligned.")]
        [SerializeField, Range(0f, 180f)] float _arrivalYawOffset = 110f;

        [Tooltip("Degrees per second used for the arrival turn specifically. Usually slower than " +
                 "BodyTurnSpeed so the first turn reads as deliberate rather than mechanical.")]
        [SerializeField, Range(10f, 720f)] float _arrivalTurnSpeed = 90f;

        [Header("Idle Motion")]
        [Tooltip("Vertical travel of the idle breathing bob, in metres. Deliberately tiny: this " +
                 "reads subconsciously, and anything visible looks like a bug.")]
        [SerializeField, Range(0f, 0.05f)] float _breathAmplitude = 0.012f;

        [Tooltip("Breathing cycles per second. Resting human respiration is about 0.2-0.3 Hz.")]
        [SerializeField, Range(0.05f, 2f)] float _breathFrequency = 0.25f;

        public float BodyTurnSpeed => _bodyTurnSpeed;
        public float GazeDeadzoneAngle => _gazeDeadzoneAngle;
        public float ArrivalYawOffset => _arrivalYawOffset;
        public float ArrivalTurnSpeed => _arrivalTurnSpeed;
        public float BreathAmplitude => _breathAmplitude;
        public float BreathFrequency => _breathFrequency;
    }
}
