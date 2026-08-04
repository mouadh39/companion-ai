using UnityEngine;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// The result of intersecting a ray with the reconstructed real world.
    /// </summary>
    /// <remarks>
    /// This is the value type every consumer outside the AR assembly works with. It contains no
    /// trackable references, so it stays valid (as a snapshot) even if the underlying plane is
    /// merged or removed a frame later — which ARCore does constantly as it refines its map.
    /// </remarks>
    public readonly struct SurfaceHit
    {
        /// <summary>World-space point of intersection.</summary>
        public readonly Vector3 Position;

        /// <summary>World-space surface normal at <see cref="Position"/>.</summary>
        public readonly Vector3 Normal;

        /// <summary>Semantic classification of the surface that was hit.</summary>
        public readonly SurfaceType Surface;

        /// <summary>Distance along the ray from its origin to <see cref="Position"/>.</summary>
        public readonly float Distance;

        /// <summary>Identifier of the surface that was hit, or <see cref="SurfaceId.Invalid"/>.</summary>
        public readonly SurfaceId Id;

        public SurfaceHit(Vector3 position, Vector3 normal, SurfaceType surface, float distance, SurfaceId id)
        {
            Position = position;
            Normal = normal;
            Surface = surface;
            Distance = distance;
            Id = id;
        }

        /// <summary>
        /// True when the surface faces upward closely enough to stand on.
        /// </summary>
        /// <param name="maxSlopeDegrees">Maximum deviation from world up that still counts as level.</param>
        public bool IsStandable(float maxSlopeDegrees) =>
            Vector3.Angle(Normal, Vector3.up) <= maxSlopeDegrees;

        /// <summary>
        /// Builds a pose that sits on the surface with its up axis along world up and its forward
        /// axis turned to face <paramref name="faceTarget"/>. Used for placing an upright character:
        /// a character must never inherit the surface tilt, only its position.
        /// </summary>
        public Pose ToUprightPose(Vector3 faceTarget)
        {
            Vector3 toTarget = faceTarget - Position;
            toTarget.y = 0f;

            Quaternion rotation = toTarget.sqrMagnitude > 1e-6f
                ? Quaternion.LookRotation(toTarget.normalized, Vector3.up)
                : Quaternion.identity;

            return new Pose(Position, rotation);
        }
    }
}
