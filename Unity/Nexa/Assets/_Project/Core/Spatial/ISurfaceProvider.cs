using System;
using System.Collections.Generic;
using UnityEngine;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// Exposes the set of real-world surfaces the device currently understands.
    /// </summary>
    /// <remarks>
    /// Intentionally named for *surfaces* rather than planes. Handheld AR reconstructs the world as
    /// planes; headsets increasingly deliver semantic meshes and scene graphs. Consumers care that a
    /// walkable region exists at a location, never how the provider arrived at it.
    /// </remarks>
    public interface ISurfaceProvider
    {
        /// <summary>All surfaces currently tracked. Valid for the current frame only.</summary>
        IReadOnlyList<DetectedSurface> Surfaces { get; }

        event Action<DetectedSurface> SurfaceAdded;
        event Action<DetectedSurface> SurfaceUpdated;
        event Action<SurfaceId> SurfaceRemoved;

        /// <summary>
        /// Looks up a surface by identifier. Returns false once the provider has merged or dropped it.
        /// </summary>
        bool TryGetSurface(SurfaceId id, out DetectedSurface surface);

        /// <summary>
        /// True when at least one tracked surface matches <paramref name="mask"/> and is at least
        /// <paramref name="minArea"/> square metres. Drives "keep scanning your room" UI.
        /// </summary>
        bool HasUsableSurface(SurfaceType mask, float minArea);

        /// <summary>
        /// Finds the height of the walkable surface beneath <paramref name="worldPosition"/>.
        /// </summary>
        /// <remarks>
        /// Lets locomotion keep the companion glued to the floor as ARCore refines plane height,
        /// without locomotion needing to know what a plane is.
        /// </remarks>
        bool TryGetSurfaceHeight(Vector3 worldPosition, SurfaceType mask, out float height);
    }
}
