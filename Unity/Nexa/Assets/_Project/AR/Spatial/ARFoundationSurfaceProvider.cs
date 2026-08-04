using System;
using System.Collections.Generic;
using Nexa.Core.Diagnostics;
using Nexa.Core.Spatial;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Nexa.AR.Spatial
{
    /// <summary>
    /// Adapts <see cref="ARPlaneManager"/> to <see cref="ISurfaceProvider"/>, maintaining a
    /// classified snapshot of the room.
    /// </summary>
    /// <remarks>
    /// Beyond translating types, this component owns the session's floor estimate. ARCore does not
    /// tell you which of its horizontal planes is the floor; it just reports planes as it finds
    /// them, often discovering a table before the ground. Tracking the lowest horizontal plane and
    /// reclassifying against it gives the rest of the app a stable notion of "the ground" on
    /// hardware with no semantic labelling at all.
    /// </remarks>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(ARPlaneManager))]
    public sealed class ARFoundationSurfaceProvider : MonoBehaviour, ISurfaceProvider
    {
        const string LogTag = nameof(ARFoundationSurfaceProvider);

        [Tooltip("How far above the lowest detected horizontal plane a surface may sit and still be " +
                 "treated as floor. Absorbs plane-height drift; too small and a single floor gets " +
                 "split into floor and table regions.")]
        [SerializeField, Range(0.02f, 0.5f)] float _floorBandHeight = 0.15f;

        [Tooltip("A plane must be at least this many square metres before it can revise the floor " +
                 "estimate. Stops a sliver plane detected on a chair from redefining the ground.")]
        [SerializeField, Range(0.05f, 3f)] float _minFloorEvidenceArea = 0.35f;

        readonly Dictionary<SurfaceId, DetectedSurface> _surfacesById = new Dictionary<SurfaceId, DetectedSurface>();
        readonly List<DetectedSurface> _surfaces = new List<DetectedSurface>();

        ARPlaneManager _planeManager;
        float _referenceFloorHeight = float.PositiveInfinity;
        bool _surfaceListDirty;

        public event Action<DetectedSurface> SurfaceAdded;
        public event Action<DetectedSurface> SurfaceUpdated;
        public event Action<SurfaceId> SurfaceRemoved;

        public IReadOnlyList<DetectedSurface> Surfaces
        {
            get
            {
                if (_surfaceListDirty)
                    RebuildSurfaceList();

                return _surfaces;
            }
        }

        /// <summary>Height of the best current floor estimate, or NaN before any floor is seen.</summary>
        public float FloorHeight => float.IsPositiveInfinity(_referenceFloorHeight) ? float.NaN : _referenceFloorHeight;

        public bool HasFloor => !float.IsPositiveInfinity(_referenceFloorHeight);

        void Awake() => _planeManager = GetComponent<ARPlaneManager>();

        void OnEnable() => _planeManager.trackablesChanged.AddListener(OnTrackablesChanged);

        void OnDisable() => _planeManager.trackablesChanged.RemoveListener(OnTrackablesChanged);

        void OnTrackablesChanged(ARTrackablesChangedEventArgs<ARPlane> args)
        {
            // Floor evidence is absorbed from the whole batch before anything is classified, so that
            // planes arriving in the same frame as a lower floor are not classified against a stale
            // reference and then immediately corrected.
            bool floorMoved = false;
            for (int i = 0; i < args.added.Count; i++)
                floorMoved |= TryLowerFloorEstimate(args.added[i]);

            for (int i = 0; i < args.updated.Count; i++)
                floorMoved |= TryLowerFloorEstimate(args.updated[i]);

            for (int i = 0; i < args.removed.Count; i++)
                RemoveSurface(args.removed[i].Key.ToSurfaceId());

            for (int i = 0; i < args.added.Count; i++)
                UpsertSurface(args.added[i], isNew: true);

            for (int i = 0; i < args.updated.Count; i++)
                UpsertSurface(args.updated[i], isNew: false);

            // A revised floor can change what every other horizontal plane means, so everything is
            // reclassified. This is rare — the estimate settles within the first seconds of a scan.
            if (floorMoved)
                ReclassifyAll();
        }

        bool TryLowerFloorEstimate(ARPlane plane)
        {
            if (plane.subsumedBy != null)
                return false;

            if (plane.alignment != UnityEngine.XR.ARSubsystems.PlaneAlignment.HorizontalUp)
                return false;

            Vector2 size = plane.size;
            if (size.x * size.y < _minFloorEvidenceArea)
                return false;

            float height = plane.center.y;
            if (height >= _referenceFloorHeight)
                return false;

            _referenceFloorHeight = height;
            NexaLog.Info(LogTag, $"Floor estimate lowered to y={height:F3}");
            return true;
        }

        void UpsertSurface(ARPlane plane, bool isNew)
        {
            // A subsumed plane has been merged into a larger one. Its geometry is stale and will
            // never update again, so it must not linger in the snapshot.
            if (plane.subsumedBy != null)
            {
                RemoveSurface(plane.trackableId.ToSurfaceId());
                return;
            }

            DetectedSurface surface = Describe(plane);
            SurfaceId id = surface.Id;

            bool existed = _surfacesById.ContainsKey(id);
            _surfacesById[id] = surface;
            _surfaceListDirty = true;

            if (isNew && !existed)
                SurfaceAdded?.Invoke(surface);
            else
                SurfaceUpdated?.Invoke(surface);
        }

        void RemoveSurface(SurfaceId id)
        {
            if (!_surfacesById.Remove(id))
                return;

            _surfaceListDirty = true;
            SurfaceRemoved?.Invoke(id);
        }

        DetectedSurface Describe(ARPlane plane)
        {
            SurfaceType type = PlaneClassificationMapper.ToSurfaceType(
                plane.classifications,
                plane.alignment,
                plane.center.y,
                _referenceFloorHeight,
                _floorBandHeight);

            Pose pose = new Pose(plane.center, plane.transform.rotation);
            return new DetectedSurface(plane.trackableId.ToSurfaceId(), pose, plane.size, type);
        }

        void ReclassifyAll()
        {
            foreach (ARPlane plane in _planeManager.trackables)
            {
                if (plane.subsumedBy != null)
                    continue;

                DetectedSurface surface = Describe(plane);
                _surfacesById[surface.Id] = surface;
                SurfaceUpdated?.Invoke(surface);
            }

            _surfaceListDirty = true;
        }

        void RebuildSurfaceList()
        {
            _surfaces.Clear();
            foreach (KeyValuePair<SurfaceId, DetectedSurface> entry in _surfacesById)
                _surfaces.Add(entry.Value);

            _surfaceListDirty = false;
        }

        public bool TryGetSurface(SurfaceId id, out DetectedSurface surface) =>
            _surfacesById.TryGetValue(id, out surface);

        public bool HasUsableSurface(SurfaceType mask, float minArea)
        {
            foreach (KeyValuePair<SurfaceId, DetectedSurface> entry in _surfacesById)
            {
                DetectedSurface surface = entry.Value;
                if ((surface.Surface & mask) != 0 && surface.Area >= minArea)
                    return true;
            }

            return false;
        }

        public bool TryGetSurfaceHeight(Vector3 worldPosition, SurfaceType mask, out float height)
        {
            bool found = false;
            float best = float.NegativeInfinity;

            foreach (KeyValuePair<SurfaceId, DetectedSurface> entry in _surfacesById)
            {
                DetectedSurface surface = entry.Value;

                if ((surface.Surface & mask) == 0 || !surface.IsHorizontal)
                    continue;

                if (!ContainsHorizontally(surface, worldPosition))
                    continue;

                // The companion stands on the highest qualifying surface at or below itself, so
                // walking onto a rug or low table reads as stepping up rather than sinking.
                float candidate = surface.Pose.position.y;
                if (candidate > worldPosition.y + _floorBandHeight)
                    continue;

                if (candidate > best)
                {
                    best = candidate;
                    found = true;
                }
            }

            height = found ? best : 0f;
            return found;
        }

        /// <summary>
        /// Tests whether a world point lies inside the surface's rectangular footprint, ignoring height.
        /// </summary>
        static bool ContainsHorizontally(in DetectedSurface surface, Vector3 worldPosition)
        {
            Vector3 local = Quaternion.Inverse(surface.Pose.rotation) * (worldPosition - surface.Pose.position);
            return Mathf.Abs(local.x) <= surface.Size.x * 0.5f &&
                   Mathf.Abs(local.z) <= surface.Size.y * 0.5f;
        }
    }
}
