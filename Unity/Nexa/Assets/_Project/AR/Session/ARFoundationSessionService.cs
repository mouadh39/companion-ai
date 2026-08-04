using System;
using Nexa.Core.Diagnostics;
using Nexa.Core.Session;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace Nexa.AR.Session
{
    /// <summary>
    /// Adapts AR Foundation's session lifecycle to <see cref="IXRSessionService"/>.
    /// </summary>
    /// <remarks>
    /// Collapses AR Foundation's eight-state machine into the smaller product-facing set and, more
    /// importantly, distinguishes "starting up for the first time" from "was tracking and lost it".
    /// AR Foundation reports both as <c>SessionInitializing</c>, but they call for opposite user
    /// messaging — "scan your room" versus "point the camera back at the room" — so the distinction
    /// is recovered here by remembering whether tracking was ever achieved.
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARFoundationSessionService : MonoBehaviour, IXRSessionService
    {
        const string LogTag = nameof(ARFoundationSessionService);

        XRSessionState _state = XRSessionState.Uninitialized;
        bool _hasEverTracked;

        public XRSessionState State
        {
            get => _state;
            private set
            {
                if (_state == value)
                    return;

                _state = value;
                NexaLog.Info(LogTag, $"Session state -> {value}");
                StateChanged?.Invoke(value);
            }
        }

        public event Action<XRSessionState> StateChanged;

        public bool IsTracking => _state == XRSessionState.Tracking;

        void OnEnable()
        {
            ARSession.stateChanged += OnARSessionStateChanged;
            // AR Foundation only raises the event on change, so a subscriber that attaches after
            // the session has already settled would otherwise sit on a stale Uninitialized state.
            Apply(ARSession.state);
        }

        void OnDisable()
        {
            ARSession.stateChanged -= OnARSessionStateChanged;
        }

        void OnARSessionStateChanged(ARSessionStateChangedEventArgs args) => Apply(args.state);

        void Apply(ARSessionState sessionState)
        {
            State = Translate(sessionState);

            if (_state == XRSessionState.Tracking)
                _hasEverTracked = true;
        }

        XRSessionState Translate(ARSessionState sessionState)
        {
            switch (sessionState)
            {
                case ARSessionState.None:
                    return XRSessionState.Uninitialized;

                case ARSessionState.Unsupported:
                    return XRSessionState.Unsupported;

                // Availability checks, provider installation and readiness are all "starting" as far
                // as the product is concerned — none of them warrant distinct UI.
                case ARSessionState.CheckingAvailability:
                case ARSessionState.NeedsInstall:
                case ARSessionState.Installing:
                case ARSessionState.Ready:
                    return XRSessionState.Initializing;

                case ARSessionState.SessionInitializing:
                    return _hasEverTracked ? XRSessionState.TrackingLost : XRSessionState.AwaitingTracking;

                case ARSessionState.SessionTracking:
                    return XRSessionState.Tracking;

                default:
                    NexaLog.Warn(LogTag, $"Unhandled ARSessionState '{sessionState}'; reporting Failed.");
                    return XRSessionState.Failed;
            }
        }
    }
}
