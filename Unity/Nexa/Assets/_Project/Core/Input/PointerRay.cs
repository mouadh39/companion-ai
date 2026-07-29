using UnityEngine;

namespace Nexa.Core.Input
{
    /// <summary>
    /// A single pointing action expressed in world space, independent of the device that produced it.
    /// </summary>
    /// <remarks>
    /// A screen tap, an eye-gaze dwell, a hand pinch and a controller trigger all collapse to
    /// "the user pointed along this ray". Keeping the abstraction at the ray means adding a new
    /// input modality is a new <see cref="IPlacementInput"/> implementation and nothing else.
    /// </remarks>
    public readonly struct PointerRay
    {
        /// <summary>World-space ray the user pointed along.</summary>
        public readonly Ray Ray;

        /// <summary>
        /// Identifies which pointer produced this, so multi-touch and two-handed input can be
        /// disambiguated later. Zero for single-pointer devices.
        /// </summary>
        public readonly int PointerId;

        public PointerRay(Ray ray, int pointerId = 0)
        {
            Ray = ray;
            PointerId = pointerId;
        }
    }
}
