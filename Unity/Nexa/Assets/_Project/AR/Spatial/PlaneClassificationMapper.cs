using Nexa.Core.Spatial;
using UnityEngine.XR.ARSubsystems;

namespace Nexa.AR.Spatial
{
    /// <summary>
    /// Translates AR Foundation's plane description into Nexa's provider-agnostic
    /// <see cref="SurfaceType"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the only place in the codebase that knows what a <c>PlaneClassifications</c> is.
    /// Ports to Android XR or visionOS supply a different mapper and change nothing else.
    /// </para>
    /// <para>
    /// The height heuristic matters more than the semantic branch in practice: most ARCore devices
    /// report <see cref="PlaneClassifications.None"/> because semantic plane labelling is only
    /// available on a subset of hardware. So a horizontal surface is resolved to floor-versus-table
    /// by comparing it against the lowest plane observed so far, which works on every device.
    /// </para>
    /// </remarks>
    public static class PlaneClassificationMapper
    {
        /// <summary>
        /// Maps a detected plane to a semantic surface type.
        /// </summary>
        /// <param name="classifications">Provider-supplied semantic labels. Often <c>None</c>.</param>
        /// <param name="alignment">Geometric orientation of the plane. Always available.</param>
        /// <param name="planeHeight">World-space Y of the plane.</param>
        /// <param name="referenceFloorHeight">Lowest horizontal plane height observed this session.</param>
        /// <param name="floorBandHeight">
        /// How far above the reference floor a horizontal plane may sit and still count as floor.
        /// Absorbs the drift and per-plane height error normal to handheld tracking.
        /// </param>
        public static SurfaceType ToSurfaceType(
            PlaneClassifications classifications,
            PlaneAlignment alignment,
            float planeHeight,
            float referenceFloorHeight,
            float floorBandHeight)
        {
            // Semantic labels are authoritative when the device actually provides them.
            if (classifications != PlaneClassifications.None)
            {
                if (classifications.HasFlag(PlaneClassifications.Floor))
                    return SurfaceType.Floor;

                if (classifications.HasFlag(PlaneClassifications.Table))
                    return SurfaceType.Table;

                // Checked before the wall cases: a couch has a vertical back that some providers
                // label with both, and seating is the more useful answer for a companion.
                if ((classifications & PlaneClassifications.SeatOfAnyType) != PlaneClassifications.None)
                    return SurfaceType.Seat;

                if (classifications.HasFlag(PlaneClassifications.DoorFrame))
                    return SurfaceType.Door;

                if (classifications.HasFlag(PlaneClassifications.WindowFrame))
                    return SurfaceType.Window;

                if (classifications.HasFlag(PlaneClassifications.Ceiling))
                    return SurfaceType.Ceiling;

                if (classifications.HasFlag(PlaneClassifications.WallFace) ||
                    classifications.HasFlag(PlaneClassifications.WallArt) ||
                    classifications.HasFlag(PlaneClassifications.InvisibleWallFace))
                {
                    return SurfaceType.Wall;
                }
            }

            // Geometry-only fallback — the path taken on most current Android hardware.
            switch (alignment)
            {
                case PlaneAlignment.HorizontalUp:
                    return planeHeight <= referenceFloorHeight + floorBandHeight
                        ? SurfaceType.Floor
                        : SurfaceType.Table;

                case PlaneAlignment.HorizontalDown:
                    return SurfaceType.Ceiling;

                case PlaneAlignment.Vertical:
                    return SurfaceType.Wall;

                default:
                    return SurfaceType.Unclassified;
            }
        }
    }
}
