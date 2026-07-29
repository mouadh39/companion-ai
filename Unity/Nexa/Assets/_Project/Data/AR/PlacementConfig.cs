using Nexa.Core.Spatial;
using UnityEngine;

namespace Nexa.Data.AR
{
    /// <summary>
    /// Rules governing where the companion is allowed to be placed or sent.
    /// </summary>
    /// <remarks>
    /// These are product rules, not engine rules, which is why they are authored data rather than
    /// constants: the acceptable placement envelope will differ between a phone held at arm's length
    /// and glasses worn on the face, and both will need retuning from user testing rather than from
    /// a code change.
    /// </remarks>
    [CreateAssetMenu(
        fileName = "PlacementConfig",
        menuName = "Nexa/AR/Placement Config",
        order = 0)]
    public sealed class PlacementConfig : ScriptableObject
    {
        [Header("Eligible Surfaces")]
        [Tooltip("Which classified surfaces accept the companion.")]
        [SerializeField] SurfaceType _placeableSurfaces = SurfaceType.Walkable | SurfaceType.Unclassified;

        [Tooltip("Smallest surface, in square metres, that will accept the companion. Rejects the " +
                 "sliver planes ARCore emits early in a scan before it has resolved the real floor.")]
        [SerializeField, Range(0.01f, 5f)] float _minSurfaceArea = 0.2f;

        [Header("Distance Envelope")]
        [Tooltip("Closest the companion may be placed to the user, in metres. Placing it inside " +
                 "personal space is startling and clips through the near plane.")]
        [SerializeField, Range(0f, 3f)] float _minDistanceFromUser = 0.5f;

        [Tooltip("Furthest the companion may be placed, in metres. Beyond a few metres handheld " +
                 "plane estimates are unreliable and the companion is placed through walls.")]
        [SerializeField, Range(0.5f, 20f)] float _maxDistanceFromUser = 6f;

        [Header("Safety")]
        [Tooltip("Reject placement while the session is not fully tracking. Poses produced during " +
                 "tracking loss are meaningless and relocate violently when tracking recovers.")]
        [SerializeField] bool _requireTracking = true;

        public SurfaceType PlaceableSurfaces => _placeableSurfaces;
        public float MinSurfaceArea => _minSurfaceArea;
        public float MinDistanceFromUser => _minDistanceFromUser;
        public float MaxDistanceFromUser => _maxDistanceFromUser;
        public bool RequireTracking => _requireTracking;

        /// <summary>
        /// Applies the distance envelope to a candidate hit.
        /// </summary>
        public bool IsWithinDistanceEnvelope(Vector3 candidate, Vector3 userPosition)
        {
            // Compared on the horizontal plane only: the user holding the phone higher than the
            // floor must not shrink the usable placement radius.
            Vector2 candidateFlat = new Vector2(candidate.x, candidate.z);
            Vector2 userFlat = new Vector2(userPosition.x, userPosition.z);
            float distance = Vector2.Distance(candidateFlat, userFlat);

            return distance >= _minDistanceFromUser && distance <= _maxDistanceFromUser;
        }

        void OnValidate()
        {
            if (_maxDistanceFromUser < _minDistanceFromUser)
                _maxDistanceFromUser = _minDistanceFromUser;
        }
    }
}
