using Nexa.Core.Input;
using Nexa.Core.Session;
using Nexa.Core.Spatial;
using Nexa.Core.User;

namespace Nexa.Core.Runtime
{
    /// <summary>
    /// A complete, interchangeable source of spatial services for the application.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Everything the app needs to understand the world arrives through one backend, so swapping
    /// where reality comes from is a single decision made once at startup rather than five
    /// independent wiring choices. Two backends exist today — real AR Foundation, and a pure
    /// in-Editor simulation — and both satisfy this contract identically.
    /// </para>
    /// <para>
    /// Every supported target reaches the app through this one contract: Android/ARCore today, and
    /// Quest and Pico passthrough later. All of them supply real camera-derived world data — the
    /// app has no notion of a synthetic environment, and must not acquire one.
    /// </para>
    /// </remarks>
    public interface IXRBackend
    {
        /// <summary>Human-readable name, surfaced in logs and debug UI to make the active mode obvious.</summary>
        string DisplayName { get; }

        /// <summary>
        /// Whether this backend can run in the current environment. Checked before activation so the
        /// app can fall back rather than start into a dead session.
        /// </summary>
        bool IsAvailable { get; }

        IXRSessionService Session { get; }

        ISurfaceProvider Surfaces { get; }

        ISurfaceRaycaster Raycaster { get; }

        /// <summary>Creates anchors that fix content to the real world.</summary>
        IAnchorService Anchors { get; }

        IUserPresence User { get; }

        IPlacementInput PlacementInput { get; }

        /// <summary>
        /// Brings the backend online. Called once by the composition root on the backend it selected;
        /// the losing backend is deactivated so two sources of truth never run at once.
        /// </summary>
        void Activate();

        void Deactivate();
    }
}
