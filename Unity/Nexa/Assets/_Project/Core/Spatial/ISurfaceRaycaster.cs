using UnityEngine;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// Intersects world-space rays against the reconstructed real world.
    /// </summary>
    /// <remarks>
    /// The input is deliberately a <see cref="Ray"/> rather than a screen point. Screen space is a
    /// handheld-only concept: AR glasses have no screen to tap. Gaze, pinch, hand rays and
    /// controller pointers all reduce to a world-space ray, so every input modality — present and
    /// future — feeds the same raycaster without changing this contract or any of its callers.
    /// </remarks>
    public interface ISurfaceRaycaster
    {
        /// <summary>
        /// Casts <paramref name="ray"/> against tracked real-world geometry.
        /// </summary>
        /// <param name="ray">World-space ray to cast.</param>
        /// <param name="mask">Which surface classifications are acceptable results.</param>
        /// <param name="hit">The nearest acceptable intersection, when this returns true.</param>
        /// <returns>True when an acceptable surface was intersected.</returns>
        bool TryRaycast(Ray ray, SurfaceType mask, out SurfaceHit hit);
    }
}
