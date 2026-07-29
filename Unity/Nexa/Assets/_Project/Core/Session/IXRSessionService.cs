using System;

namespace Nexa.Core.Session
{
    /// <summary>
    /// Reports the health of the underlying XR session.
    /// </summary>
    public interface IXRSessionService
    {
        XRSessionState State { get; }

        /// <summary>Raised on the main thread whenever <see cref="State"/> changes.</summary>
        event Action<XRSessionState> StateChanged;

        /// <summary>
        /// True only in <see cref="XRSessionState.Tracking"/>. Guard every world-space interaction
        /// with this: poses produced while tracking is lost are meaningless and will teleport the
        /// companion across the room when tracking returns.
        /// </summary>
        bool IsTracking { get; }
    }
}
