using System.Collections.Generic;
using Nexa.Core.Spatial;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Nexa.AR.Spatial
{
    /// <summary>
    /// Adapts <see cref="ARRaycastManager"/> to <see cref="ISurfaceRaycaster"/>.
    /// </summary>
    /// <remarks>
    /// Classification of the hit surface is delegated to <see cref="ARFoundationSurfaceProvider"/>
    /// rather than recomputed here, so there is exactly one place in the system that decides what a
    /// given plane means. Two independent classifiers would eventually disagree, and the resulting
    /// bug — placement accepting a surface the navigation layer rejects — is painful to track down.
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARFoundationSurfaceRaycaster : MonoBehaviour, ISurfaceRaycaster
    {
        [Tooltip("Raycast manager to query. Resolved from this GameObject when left empty.")]
        [SerializeField] ARRaycastManager _raycastManager;

        [Tooltip("Supplies the semantic classification of whatever the ray hits.")]
        [SerializeField] ARFoundationSurfaceProvider _surfaceProvider;

        /// <summary>
        /// Reused across calls so that placement — which happens on user input, often during a
        /// frame already busy with plane updates — never allocates.
        /// </summary>
        readonly List<ARRaycastHit> _hitBuffer = new List<ARRaycastHit>(8);

        void Awake()
        {
            if (_raycastManager == null)
                _raycastManager = GetComponent<ARRaycastManager>();
        }

        public bool TryRaycast(Ray ray, SurfaceType mask, out SurfaceHit hit)
        {
            hit = default;

            if (_raycastManager == null)
                return false;

            // PlaneWithinPolygon respects each plane's detected boundary. The alternatives extend
            // planes to infinity or to their bounding rectangle, which lets the companion be placed
            // in mid-air beyond the edge of a table.
            if (!_raycastManager.Raycast(ray, _hitBuffer, TrackableType.PlaneWithinPolygon))
                return false;

            // Results arrive sorted nearest-first, so the first acceptable hit is the one the user
            // visually aimed at.
            for (int i = 0; i < _hitBuffer.Count; i++)
            {
                ARRaycastHit candidate = _hitBuffer[i];
                SurfaceId id = candidate.trackableId.ToSurfaceId();
                SurfaceType type = ResolveSurfaceType(id);

                if ((type & mask) == 0)
                    continue;

                Pose pose = candidate.pose;
                hit = new SurfaceHit(pose.position, pose.up, type, candidate.distance, id);
                return true;
            }

            return false;
        }

        SurfaceType ResolveSurfaceType(SurfaceId id)
        {
            if (_surfaceProvider != null && _surfaceProvider.TryGetSurface(id, out DetectedSurface surface))
                return surface.Surface;

            // The provider can legitimately lag the raycaster by a frame for a freshly detected
            // plane. Reporting Unclassified lets permissive placement masks still succeed rather
            // than silently dropping the user's very first tap.
            return SurfaceType.Unclassified;
        }
    }
}
