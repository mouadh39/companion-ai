namespace Nexa.Core.Session
{
    /// <summary>
    /// Lifecycle of the underlying XR session, reduced to the states the product actually reacts to.
    /// </summary>
    /// <remarks>
    /// Deliberately smaller than <c>ARSessionState</c>. Provider enums carry states that exist for
    /// provider-internal reasons; mapping down to this set means UI and app flow never grow a
    /// <c>switch</c> arm for a state that has no distinct product meaning, and never break when a
    /// provider adds one.
    /// </remarks>
    public enum XRSessionState
    {
        /// <summary>Nothing has started yet.</summary>
        Uninitialized = 0,

        /// <summary>This device cannot run AR at all. Terminal — show a fallback experience.</summary>
        Unsupported = 1,

        /// <summary>Checking availability, installing provider services, or starting up.</summary>
        Initializing = 2,

        /// <summary>Blocked awaiting a user grant (camera permission).</summary>
        AwaitingPermission = 3,

        /// <summary>Session runs, but pose tracking is not usable yet. Prompt the user to move.</summary>
        AwaitingTracking = 4,

        /// <summary>Fully tracking. The only state in which placement is allowed.</summary>
        Tracking = 5,

        /// <summary>Was tracking and lost it (covered camera, dark room, fast motion). Recoverable.</summary>
        TrackingLost = 6,

        /// <summary>Session failed in a way it will not recover from on its own.</summary>
        Failed = 7
    }
}
