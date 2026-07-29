using System;
using Nexa.Character;
using Nexa.Core.Diagnostics;
using Nexa.Core.Input;
using Nexa.Core.Session;
using Nexa.Core.Spatial;
using Nexa.Core.User;
using Nexa.Data.AR;
using Nexa.Data.Companion;
using UnityEngine;

namespace Nexa.App
{
    /// <summary>
    /// Owns the single companion: brings it into the world on the first valid tap and re-anchors it
    /// on later ones.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is application policy — what a tap <i>means</i> — deliberately kept out of both the
    /// input layer and the companion. Input reports that the user pointed somewhere; the companion
    /// knows how to stand and how to look at someone; neither should encode the product decision
    /// that a tap places it. When placement grows richer (summon, dismiss, sit here), it grows here.
    /// </para>
    /// <para>
    /// Exactly one companion exists, ever. Later taps move the existing one rather than spawning a
    /// second — and they move it by re-anchoring, not by walking. Walking is navigation, which is a
    /// later milestone; a placement system that quietly grew a pathfinder would be the wrong thing
    /// in the wrong layer.
    /// </para>
    /// <para>
    /// The companion is always parented to a platform anchor and never positioned in world space
    /// directly. The platform continuously corrects anchor poses as it learns more about the room,
    /// and only a child of the anchor inherits those corrections. That single detail is the
    /// difference between a companion that stays put on a real floor while the user walks around it
    /// and one that visibly slides away.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class CompanionDirector : MonoBehaviour
    {
        const string LogTag = nameof(CompanionDirector);

        [Header("Prefab")]
        [Tooltip("Companion prefab. Must carry a CompanionController. Its origin must sit at the " +
                 "character's feet so it stands on the surface rather than sinking into it.")]
        [SerializeField] GameObject _companionPrefab;

        [Header("Configuration")]
        [SerializeField] PlacementConfig _placementConfig;
        [SerializeField] CompanionLocomotionConfig _locomotionConfig;
        [SerializeField] CompanionPresenceConfig _presenceConfig;

        [Header("Behaviour")]
        [Tooltip("Allow later taps to move the companion to a new surface. When off, the companion " +
                 "is placed once per session and further taps are ignored.")]
        [SerializeField] bool _allowRepositioning = true;

        IPlacementInput _placementInput;
        ISurfaceRaycaster _raycaster;
        ISurfaceProvider _surfaces;
        IAnchorService _anchors;
        IUserPresence _user;
        IXRSessionService _session;

        CompanionController _companion;
        IAnchorHandle _anchor;
        bool _isInitialized;
        bool _isVisible = true;

        /// <summary>The live companion, or null before it has been placed.</summary>
        public CompanionController Companion => _companion;

        public bool HasCompanion => _companion != null;

        /// <summary>
        /// Raised once, when the companion first enters the world. Lets onboarding UI retire itself
        /// without the director needing to know that any UI exists.
        /// </summary>
        public event Action<CompanionController> CompanionPlaced;

        public void Initialize(
            IPlacementInput placementInput,
            ISurfaceRaycaster raycaster,
            ISurfaceProvider surfaces,
            IAnchorService anchors,
            IUserPresence user,
            IXRSessionService session)
        {
            if (!ValidateConfiguration())
                return;

            _placementInput = placementInput;
            _raycaster = raycaster;
            _surfaces = surfaces;
            _anchors = anchors;
            _user = user;
            _session = session;

            _placementInput.Confirmed += OnPointerConfirmed;
            _session.StateChanged += OnSessionStateChanged;
            OnSessionStateChanged(_session.State);

            _isInitialized = true;
        }

        void OnDestroy()
        {
            if (!_isInitialized)
                return;

            _placementInput.Confirmed -= OnPointerConfirmed;
            _session.StateChanged -= OnSessionStateChanged;

            // An anchor is a platform resource, not just a Transform, and must be handed back.
            ReleaseAnchor();
        }

        void Update()
        {
            // Anchor tracking confidence is a poll, not an event, so it has to be sampled. The cost
            // is one property read and a bool compare for one companion — the alternative, showing
            // the companion at a pose the platform has told us it doubts, makes it appear to drift
            // through the room and reads as a bug in the app rather than a limit of tracking.
            if (_companion == null || _anchor == null)
                return;

            bool shouldBeVisible = _anchor.IsTracking;
            if (shouldBeVisible == _isVisible)
                return;

            _isVisible = shouldBeVisible;
            _companion.gameObject.SetActive(shouldBeVisible);
        }

        void OnSessionStateChanged(XRSessionState state)
        {
            // Input is gated centrally rather than re-checked at every use site, so a tap taken
            // while tracking is lost is never even delivered.
            if (_placementConfig.RequireTracking)
                _placementInput.Enabled = state == XRSessionState.Tracking;
        }

        void OnPointerConfirmed(PointerRay pointer)
        {
            if (!_raycaster.TryRaycast(pointer.Ray, _placementConfig.PlaceableSurfaces, out SurfaceHit hit))
                return;

            if (!IsAcceptable(hit))
                return;

            if (_companion == null)
                SpawnCompanion(hit);
            else if (_allowRepositioning)
                RelocateCompanion(hit);
        }

        bool IsAcceptable(in SurfaceHit hit)
        {
            if (!_user.IsValid)
                return false;

            if (!_placementConfig.IsWithinDistanceEnvelope(hit.Position, _user.HeadPose.position))
            {
                NexaLog.Info(LogTag, "Rejected placement: outside the allowed distance envelope.");
                return false;
            }

            if (!hit.IsStandable(_locomotionConfig.MaxSlopeAngle))
            {
                NexaLog.Info(LogTag, "Rejected placement: surface is too steep to stand on.");
                return false;
            }

            return true;
        }

        void SpawnCompanion(in SurfaceHit hit)
        {
            if (!TryAnchor(hit, out IAnchorHandle anchor))
                return;

            GameObject instance = Instantiate(_companionPrefab, anchor.Transform);
            instance.name = _companionPrefab.name;

            _companion = instance.GetComponent<CompanionController>();
            if (_companion == null)
            {
                NexaLog.Error(LogTag,
                    $"Companion prefab '{_companionPrefab.name}' has no {nameof(CompanionController)}.", this);
                Destroy(instance);
                anchor.Dispose();
                return;
            }

            _anchor = anchor;
            _isVisible = true;

            _companion.Initialize(_user, _surfaces, _locomotionConfig, _presenceConfig);
            _companion.AttachToAnchor(anchor.Transform);

            NexaLog.Info(LogTag, $"Companion anchored at {hit.Position} on {hit.Surface}.");
            CompanionPlaced?.Invoke(_companion);
        }

        void RelocateCompanion(in SurfaceHit hit)
        {
            if (!TryAnchor(hit, out IAnchorHandle anchor))
                return;

            // The old anchor is released only after the new one is committed. Releasing first would
            // leave the companion unparented for a frame if the platform then declined the new
            // anchor, dropping it at a stale world pose.
            ReleaseAnchor();

            _anchor = anchor;
            _isVisible = true;

            if (!_companion.gameObject.activeSelf)
                _companion.gameObject.SetActive(true);

            // Re-attaching runs the arrival turn again: the companion has moved somewhere new, so
            // orienting itself to the user there is the same beat as arriving.
            _companion.AttachToAnchor(anchor.Transform);

            NexaLog.Info(LogTag, $"Companion re-anchored at {hit.Position} on {hit.Surface}.");
        }

        /// <summary>
        /// Creates the anchor for a placement, oriented so the companion starts out turned away from
        /// the user by the configured arrival offset.
        /// </summary>
        /// <remarks>
        /// The offset is baked into the anchor rather than applied to the companion, so the
        /// companion itself can sit at a clean local identity under its anchor. Gaze then turns it
        /// to meet the user over the following frames.
        /// </remarks>
        bool TryAnchor(in SurfaceHit hit, out IAnchorHandle anchor)
        {
            Quaternion facingUser = hit.ToUprightPose(_user.HeadPose.position).rotation;

            // Turn side is randomised so repeated placements do not all pivot the same way, which
            // reads as a scripted animation rather than as a character noticing someone.
            float offset = _presenceConfig.ArrivalYawOffset * (UnityEngine.Random.value < 0.5f ? -1f : 1f);
            Quaternion arrival = facingUser * Quaternion.Euler(0f, offset, 0f);

            if (_anchors.TryCreateAnchor(hit, arrival, out anchor))
                return true;

            NexaLog.Info(LogTag, "Platform declined the anchor; placement abandoned this frame.");
            return false;
        }

        void ReleaseAnchor()
        {
            _anchor?.Dispose();
            _anchor = null;
        }

        bool ValidateConfiguration()
        {
            if (_companionPrefab == null)
            {
                NexaLog.Error(LogTag, "No companion prefab assigned.", this);
                return false;
            }

            if (_placementConfig == null || _locomotionConfig == null || _presenceConfig == null)
            {
                NexaLog.Error(LogTag, "One or more configuration assets are unassigned.", this);
                return false;
            }

            return true;
        }
    }
}
