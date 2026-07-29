using UnityEngine;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// A snapshot of one tracked real-world surface as understood by the current XR provider.
    /// </summary>
    public readonly struct DetectedSurface
    {
        public readonly SurfaceId Id;

        /// <summary>Centre pose of the surface. Its up axis is the surface normal.</summary>
        public readonly Pose Pose;

        /// <summary>Full width and length of the surface in metres, in surface-local space.</summary>
        public readonly Vector2 Size;

        public readonly SurfaceType Surface;

        public DetectedSurface(SurfaceId id, Pose pose, Vector2 size, SurfaceType surface)
        {
            Id = id;
            Pose = pose;
            Size = size;
            Surface = surface;
        }

        /// <summary>Approximate area in square metres. Used to reject noise-sized detections.</summary>
        public float Area => Size.x * Size.y;

        public bool IsHorizontal => Mathf.Abs(Vector3.Dot(Pose.up, Vector3.up)) > 0.85f;
    }
}
