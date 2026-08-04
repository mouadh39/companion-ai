using UnityEngine;

namespace Nexa.Data.Companion
{
    /// <summary>
    /// Tuning for how the companion physically moves through the user's room.
    /// </summary>
    /// <remarks>
    /// Held as an asset rather than inspector fields on a prefab so that motion can be retuned
    /// without touching the prefab — which keeps designers out of the file that engineers merge —
    /// and so that distinct companion personalities can share one prefab with different movement
    /// feels later.
    /// </remarks>
    [CreateAssetMenu(
        fileName = "CompanionLocomotionConfig",
        menuName = "Nexa/Companion/Locomotion Config",
        order = 0)]
    public sealed class CompanionLocomotionConfig : ScriptableObject
    {
        [Header("Translation")]
        [Tooltip("Peak walking speed in metres per second. Real indoor spaces are small: values " +
                 "above roughly 1.2 make the companion feel like it is skating across the room.")]
        [SerializeField, Range(0.05f, 3f)] float _moveSpeed = 0.7f;

        [Tooltip("Metres per second squared. Governs how sharply the companion starts and stops.")]
        [SerializeField, Range(0.1f, 20f)] float _acceleration = 3f;

        [Tooltip("Distance from the destination at which the companion is considered arrived. " +
                 "Must exceed one frame of travel or the companion will orbit its target forever.")]
        [SerializeField, Range(0.01f, 0.5f)] float _arrivalTolerance = 0.08f;

        [Header("Rotation")]
        [Tooltip("Peak turn rate in degrees per second while walking.")]
        [SerializeField, Range(30f, 1080f)] float _angularSpeed = 320f;

        [Tooltip("If the destination is further off-axis than this, the companion turns on the spot " +
                 "before walking. Prevents the wide, unnatural arcs that pure steering produces.")]
        [SerializeField, Range(0f, 180f)] float _turnInPlaceAngle = 70f;

        [Header("Ground Adherence")]
        [Tooltip("How fast the companion settles onto the detected floor height, in metres per " +
                 "second. ARCore refines plane height continuously; snapping instantly makes the " +
                 "companion visibly jitter, so it is eased instead.")]
        [SerializeField, Range(0.1f, 20f)] float _groundSettleSpeed = 4f;

        [Tooltip("Steepest surface tilt still treated as standable.")]
        [SerializeField, Range(0f, 60f)] float _maxSlopeAngle = 25f;

        public float MoveSpeed => _moveSpeed;
        public float Acceleration => _acceleration;
        public float ArrivalTolerance => _arrivalTolerance;
        public float AngularSpeed => _angularSpeed;
        public float TurnInPlaceAngle => _turnInPlaceAngle;
        public float GroundSettleSpeed => _groundSettleSpeed;
        public float MaxSlopeAngle => _maxSlopeAngle;

        void OnValidate()
        {
            // A tolerance smaller than the distance covered in one 30 Hz frame makes arrival
            // unreachable, so the companion would jitter around its destination indefinitely.
            float minimumUsableTolerance = _moveSpeed / 30f;
            if (_arrivalTolerance < minimumUsableTolerance)
                _arrivalTolerance = minimumUsableTolerance;
        }
    }
}
