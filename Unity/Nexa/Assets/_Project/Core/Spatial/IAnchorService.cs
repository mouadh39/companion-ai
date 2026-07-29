using UnityEngine;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// A live anchor holding a fixed pose in the real world.
    /// </summary>
    /// <remarks>
    /// Content is parented to <see cref="Transform"/> rather than positioned once and forgotten.
    /// The platform continuously corrects an anchor's pose as its understanding of the room
    /// improves, and only parented content inherits those corrections — which is the difference
    /// between an object that stays put as the user walks and one that visibly drifts.
    /// </remarks>
    public interface IAnchorHandle
    {
        /// <summary>Transform to parent content under. Moves as the platform refines the anchor.</summary>
        Transform Transform { get; }

        /// <summary>
        /// False when the platform has temporarily lost confidence in this anchor's pose. Content
        /// should be hidden rather than shown at a pose known to be wrong.
        /// </summary>
        bool IsTracking { get; }

        /// <summary>Releases the anchor and its platform resources.</summary>
        void Dispose();
    }

    /// <summary>
    /// Creates anchors that fix content to real-world locations.
    /// </summary>
    /// <remarks>
    /// Abstracted because anchoring is where target platforms diverge most sharply. Handheld ARCore
    /// anchors live only for the session; Quest and Pico spatial anchors can be saved and restored
    /// across sessions and shared between users. Keeping placement code behind this interface means
    /// adding persistence later changes the implementation, not every caller.
    /// </remarks>
    public interface IAnchorService
    {
        /// <summary>False when the running platform provides no anchor subsystem.</summary>
        bool IsSupported { get; }

        /// <summary>
        /// Creates an anchor at a surface the user selected.
        /// </summary>
        /// <param name="hit">The surface intersection to anchor to.</param>
        /// <param name="rotation">World-space rotation for the anchor.</param>
        /// <param name="anchor">The created anchor, when this returns true.</param>
        /// <returns>
        /// False when the platform declines — typically because the surface has been merged away or
        /// tracking is not currently good enough to commit a pose.
        /// </returns>
        bool TryCreateAnchor(in SurfaceHit hit, Quaternion rotation, out IAnchorHandle anchor);
    }
}
