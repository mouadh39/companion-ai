using Nexa.Core.Diagnostics;
using Nexa.Core.Spatial;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Nexa.AR.Spatial
{
    /// <summary>
    /// Creates AR Foundation anchors attached to detected planes.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Anchors are attached to the plane the user actually tapped, using
    /// <see cref="ARAnchorManager.AttachAnchor"/>, rather than dropped as free world anchors. ARCore
    /// revises a plane's pose continuously as it observes more of the room; an attached anchor
    /// inherits those revisions, so content stays welded to the real surface. A free anchor at the
    /// same coordinates would slowly separate from the surface it was meant to sit on.
    /// </para>
    /// <para>
    /// This one implementation covers every AR Foundation target — Android/ARCore today, and Quest
    /// and Pico passthrough via OpenXR later — because they all expose the same anchor subsystem.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARFoundationAnchorService : MonoBehaviour, IAnchorService
    {
        const string LogTag = nameof(ARFoundationAnchorService);

        [Tooltip("Anchor manager used to create anchors. Resolved from this GameObject when empty.")]
        [SerializeField] ARAnchorManager _anchorManager;

        [Tooltip("Plane manager used to resolve which plane a raycast hit. Resolved when empty.")]
        [SerializeField] ARPlaneManager _planeManager;

        void Awake()
        {
            if (_anchorManager == null)
                _anchorManager = GetComponent<ARAnchorManager>();

            if (_planeManager == null)
                _planeManager = GetComponent<ARPlaneManager>();
        }

        public bool IsSupported =>
            _anchorManager != null && _anchorManager.enabled && _anchorManager.subsystem != null;

        public bool TryCreateAnchor(in SurfaceHit hit, Quaternion rotation, out IAnchorHandle anchor)
        {
            anchor = null;

            if (!IsSupported)
            {
                NexaLog.Warn(LogTag, "Anchor subsystem is unavailable; cannot anchor content.", this);
                return false;
            }

            ARPlane plane = ResolvePlane(hit.Id);
            if (plane == null)
            {
                // Expected, not exceptional: ARCore merges planes constantly, so the plane a ray hit
                // moments ago may already have been absorbed into a larger one.
                NexaLog.Info(LogTag, $"Plane {hit.Id} no longer exists; anchor request dropped.");
                return false;
            }

            ARAnchor created = _anchorManager.AttachAnchor(plane, new Pose(hit.Position, rotation));
            if (created == null)
            {
                NexaLog.Info(LogTag, "Provider declined the anchor request.");
                return false;
            }

            anchor = new ARFoundationAnchorHandle(created, _anchorManager);
            return true;
        }

        ARPlane ResolvePlane(SurfaceId id)
        {
            if (_planeManager == null || !id.IsValid)
                return null;

            return _planeManager.GetPlane(id.ToTrackableId());
        }

        /// <summary>
        /// Wraps an <see cref="ARAnchor"/> behind the provider-agnostic handle contract.
        /// </summary>
        sealed class ARFoundationAnchorHandle : IAnchorHandle
        {
            readonly ARAnchor _anchor;
            readonly ARAnchorManager _manager;

            public ARFoundationAnchorHandle(ARAnchor anchor, ARAnchorManager manager)
            {
                _anchor = anchor;
                _manager = manager;
            }

            public Transform Transform => _anchor != null ? _anchor.transform : null;

            // Limited tracking is treated as not tracking: a pose the provider is unsure about is a
            // pose that will visibly jump once it becomes sure.
            public bool IsTracking => _anchor != null && _anchor.trackingState == TrackingState.Tracking;

            public void Dispose()
            {
                if (_anchor == null || _manager == null)
                    return;

                _manager.TryRemoveAnchor(_anchor);
            }
        }
    }
}
