using System;

namespace Nexa.Core.Input
{
    /// <summary>
    /// Emits confirmed pointing actions from whatever input hardware the platform provides.
    /// </summary>
    public interface IPlacementInput
    {
        /// <summary>
        /// Raised when the user *commits* to pointing somewhere — a tap that lifted, a pinch that
        /// closed, a gaze that dwelled long enough. Never raised for hover or in-progress motion,
        /// so consumers do not have to debounce.
        /// </summary>
        event Action<PointerRay> Confirmed;

        /// <summary>
        /// Gates emission. Set false while the session is not tracking or while UI has focus, so
        /// consumers never have to re-check preconditions they did not establish.
        /// </summary>
        bool Enabled { get; set; }
    }
}
