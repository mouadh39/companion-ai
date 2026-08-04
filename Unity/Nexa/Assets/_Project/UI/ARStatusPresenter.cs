using Nexa.Core.Session;
using Nexa.Core.Spatial;
using TMPro;
using UnityEngine;

namespace Nexa.UI
{
    /// <summary>
    /// Tells the user what the system needs from them right now.
    /// </summary>
    /// <remarks>
    /// <para>
    /// AR fails silently by default: a user pointing a phone at an unscanned room sees a plain
    /// camera feed and concludes the app is broken. Nothing works until enough of the room is
    /// mapped, and the only thing that maps it is the user physically moving — so telling them to
    /// move is a functional requirement, not decoration.
    /// </para>
    /// <para>
    /// Copy lives in serialized fields rather than string literals so it can be localised and
    /// tuned by whoever owns the product voice, without a code change.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARStatusPresenter : MonoBehaviour
    {
        [Header("View")]
        [SerializeField] TMP_Text _label;

        [Tooltip("Hidden once the companion is placed, so the prompt does not sit over the experience.")]
        [SerializeField] CanvasGroup _canvasGroup;

        [Header("Copy")]
        [SerializeField] string _unsupported = "This device doesn't support AR.";
        [SerializeField] string _initializing = "Starting up…";
        [SerializeField] string _awaitingTracking = "Move your phone slowly to look around.";
        [SerializeField] string _trackingLost = "Point your camera back at the room.";
        [SerializeField] string _scanning = "Keep looking around to find the floor.";
        [SerializeField] string _readyToPlace = "Tap the floor to place your companion.";
        [SerializeField] string _failed = "Something went wrong with AR. Please restart the app.";

        [Header("Surface Requirement")]
        [Tooltip("Which surfaces count as 'enough of the room mapped to begin'.")]
        [SerializeField] SurfaceType _requiredSurfaces = SurfaceType.Walkable | SurfaceType.Unclassified;

        [Tooltip("How many square metres of qualifying surface must exist before prompting to place.")]
        [SerializeField, Range(0.05f, 5f)] float _requiredArea = 0.3f;

        IXRSessionService _session;
        ISurfaceProvider _surfaces;
        bool _isInitialized;
        bool _isDismissed;

        public void Initialize(IXRSessionService session, ISurfaceProvider surfaces)
        {
            _session = session;
            _surfaces = surfaces;
            _isInitialized = true;

            Refresh();
        }

        /// <summary>
        /// Permanently hides the prompt. Called once the companion exists, since every message here
        /// is about getting to that point.
        /// </summary>
        public void Dismiss()
        {
            _isDismissed = true;
            SetVisible(false);
        }

        void Update()
        {
            if (!_isInitialized || _isDismissed)
                return;

            // Polled rather than event-driven because the message depends on surface coverage, which
            // changes continuously during a scan rather than at discrete moments.
            Refresh();
        }

        void Refresh()
        {
            if (_label == null)
                return;

            SetVisible(true);
            _label.text = ResolveMessage();
        }

        string ResolveMessage()
        {
            switch (_session.State)
            {
                case XRSessionState.Unsupported:
                    return _unsupported;

                case XRSessionState.Uninitialized:
                case XRSessionState.Initializing:
                case XRSessionState.AwaitingPermission:
                    return _initializing;

                case XRSessionState.AwaitingTracking:
                    return _awaitingTracking;

                case XRSessionState.TrackingLost:
                    return _trackingLost;

                case XRSessionState.Failed:
                    return _failed;

                case XRSessionState.Tracking:
                    return _surfaces.HasUsableSurface(_requiredSurfaces, _requiredArea)
                        ? _readyToPlace
                        : _scanning;

                default:
                    return _initializing;
            }
        }

        void SetVisible(bool visible)
        {
            if (_canvasGroup == null)
                return;

            _canvasGroup.alpha = visible ? 1f : 0f;
            _canvasGroup.blocksRaycasts = false;
            _canvasGroup.interactable = false;
        }
    }
}
