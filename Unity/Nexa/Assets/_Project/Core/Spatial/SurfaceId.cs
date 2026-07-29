using System;

namespace Nexa.Core.Spatial
{
    /// <summary>
    /// Stable, provider-agnostic identifier for a tracked real-world surface.
    /// </summary>
    /// <remarks>
    /// Deliberately shaped as two 64-bit words so it maps losslessly onto
    /// <c>UnityEngine.XR.ARSubsystems.TrackableId</c> (and the equivalent identifiers used by
    /// Android XR / visionOS) without <c>Nexa.Core</c> taking a dependency on any XR package.
    /// The conversion lives in the AR assembly, which is the only place allowed to know about
    /// provider types.
    /// </remarks>
    [Serializable]
    public readonly struct SurfaceId : IEquatable<SurfaceId>
    {
        public readonly ulong SubId1;
        public readonly ulong SubId2;

        public SurfaceId(ulong subId1, ulong subId2)
        {
            SubId1 = subId1;
            SubId2 = subId2;
        }

        /// <summary>The identifier assigned to surfaces that are not tracked (e.g. simulated ground).</summary>
        public static SurfaceId Invalid => default;

        public bool IsValid => SubId1 != 0UL || SubId2 != 0UL;

        public bool Equals(SurfaceId other) => SubId1 == other.SubId1 && SubId2 == other.SubId2;

        public override bool Equals(object obj) => obj is SurfaceId other && Equals(other);

        public override int GetHashCode() => HashCode.Combine(SubId1, SubId2);

        public override string ToString() => $"{SubId1:x16}-{SubId2:x16}";

        public static bool operator ==(SurfaceId a, SurfaceId b) => a.Equals(b);

        public static bool operator !=(SurfaceId a, SurfaceId b) => !a.Equals(b);
    }
}
