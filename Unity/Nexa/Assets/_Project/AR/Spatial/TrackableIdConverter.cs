using Nexa.Core.Spatial;
using UnityEngine.XR.ARSubsystems;

namespace Nexa.AR.Spatial
{
    /// <summary>
    /// Converts between AR Foundation trackable identifiers and Nexa's provider-agnostic
    /// <see cref="SurfaceId"/>.
    /// </summary>
    public static class TrackableIdConverter
    {
        public static SurfaceId ToSurfaceId(this TrackableId id) => new SurfaceId(id.subId1, id.subId2);

        public static TrackableId ToTrackableId(this SurfaceId id) => new TrackableId(id.SubId1, id.SubId2);
    }
}
