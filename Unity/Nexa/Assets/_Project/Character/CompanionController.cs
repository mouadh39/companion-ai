using Nexa.Character.Animation;
using Nexa.Character.Gaze;
using Nexa.Character.Locomotion;
using Nexa.Character.States;
using Nexa.Core.Diagnostics;
using Nexa.Core.Spatial;
using Nexa.Core.User;
using Nexa.Data.Companion;
using UnityEngine;

namespace Nexa.Character
{
    /// <summary>
    /// The companion's public face: the single component anything outside the character talks to.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Everything the companion is made of — locomotion, animation, gaze, its state machine — is
    /// private behind this facade. Callers express intent (<see cref="WalkTo"/>,
    /// <see cref="PlaceAt"/>) and never reach into the parts. That is what will let the companion
    /// grow voice, memory and emotion without every new system needing to understand its internals.
    /// </para>
    /// <para>
    /// Note what this class does <b>not</b> reference: nothing from AR Foundation, and no camera.
    /// It receives an <see cref="IUserPresence"/> and an <see cref="ISurfaceProvider"/> and is
    /// otherwise ignorant of how the world is being sensed. The companion runs unchanged on a
    /// phone, on glasses, or against a fake world in a test.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class CompanionController : MonoBehaviour
    {
        const string LogTag = nameof(CompanionController);

        [Header("Parts")]
        [SerializeField] SteeringLocomotion _locomotion;
        [SerializeField] MecanimCompanionAnimator _animator;
        [SerializeField] CompanionGaze _gaze;
        [SerializeField] CompanionIdleMotion _idleMotion;

        readonly CompanionStateMachine _stateMachine = new CompanionStateMachine();

        CompanionIdleState _idleState;
        CompanionMoveState _moveState;
        bool _isInitialized;

        /// <summary>True once the composition root has supplied dependencies.</summary>
        public bool IsReady => _isInitialized;

        /// <summary>Current world pose of the companion.</summary>
        public Pose Pose => new Pose(transform.position, transform.rotation);

        /// <summary>True while the companion is parented to a platform anchor.</summary>
        public bool IsAnchored => transform.parent != null;

        /// <summary>True once the companion has finished turning to meet the user.</summary>
        public bool IsFacingUser => _gaze != null && _gaze.IsFacingUser;

        void Reset()
        {
            // Populates the prefab's references on first add, so wiring is not a manual step that
            // can be forgotten and then fails silently at runtime.
            _locomotion = GetComponent<SteeringLocomotion>();
            _animator = GetComponent<MecanimCompanionAnimator>();
            _gaze = GetComponent<CompanionGaze>();
            _idleMotion = GetComponent<CompanionIdleMotion>();
        }

        /// <summary>
        /// Supplies every dependency the companion needs. Must be called before the companion does
        /// anything; the spawner calls it immediately after instantiation.
        /// </summary>
        public void Initialize(
            IUserPresence user,
            ISurfaceProvider surfaces,
            CompanionLocomotionConfig locomotionConfig,
            CompanionPresenceConfig presenceConfig)
        {
            if (!ValidateParts())
                return;

            _locomotion.Initialize(locomotionConfig, surfaces);
            _gaze.Initialize(user, presenceConfig);
            _idleMotion.Initialize(presenceConfig);

            _idleState = new CompanionIdleState(_locomotion, _animator, _gaze, _idleMotion);
            _moveState = new CompanionMoveState(_locomotion, _animator, _idleMotion);

            _locomotion.DestinationReached += OnDestinationReached;

            _isInitialized = true;
            _stateMachine.ChangeState(_idleState);
        }

        void OnDestroy()
        {
            if (_locomotion != null)
                _locomotion.DestinationReached -= OnDestinationReached;
        }

        void Update()
        {
            if (!_isInitialized)
                return;

            _stateMachine.Tick(Time.deltaTime);
        }

        /// <summary>
        /// Teleports the companion to a pose and returns it to idle. Used for first placement and
        /// for re-anchoring, where walking there would be wrong.
        /// </summary>
        /// <remarks>
        /// This is the unanchored path: the companion owns its own world position and keeps itself
        /// on detected ground. Use <see cref="AttachToAnchor"/> whenever a platform anchor is
        /// available, which on a real device is always.
        /// </remarks>
        public void PlaceAt(Pose pose)
        {
            if (!_isInitialized)
                return;

            _locomotion.SetGroundAdherence(true);
            _locomotion.Warp(pose);
            _stateMachine.ChangeState(_idleState);
        }

        /// <summary>
        /// Parents the companion to a platform anchor at local origin and starts its arrival turn.
        /// </summary>
        /// <param name="anchor">
        /// Transform of a live anchor. The companion sits at local zero underneath it and never
        /// writes its own world position again, so every pose correction the platform applies to the
        /// anchor is inherited for free. This is what keeps the companion welded to a real surface
        /// while the user walks around it.
        /// </param>
        /// <remarks>
        /// Ground adherence is switched off here rather than left on and ignored. Under an anchor
        /// the two mechanisms are not merely redundant, they are in direct conflict: adherence
        /// writes world Y from the surface provider while the platform writes the anchor's pose from
        /// its own map, and the companion ends up ratcheting away from the anchor origin.
        /// </remarks>
        public void AttachToAnchor(Transform anchor)
        {
            if (!_isInitialized || anchor == null)
                return;

            _locomotion.Stop();
            _locomotion.SetGroundAdherence(false);

            transform.SetParent(anchor, worldPositionStays: false);
            transform.localPosition = Vector3.zero;
            transform.localRotation = Quaternion.identity;

            _stateMachine.ChangeState(_idleState);

            // Begun after the state change so the idle state's first tick performs the turn.
            _gaze.BeginArrival();
        }

        /// <summary>Commands the companion to walk to a world position.</summary>
        /// <remarks>
        /// Refused while anchored. Walking means the companion owns its position again, which
        /// requires detaching from the anchor and restoring ground adherence first — a deliberate
        /// hand-off that belongs to the locomotion milestone, not to placement. Guarded rather than
        /// left to work by accident, because the failure it prevents is subtle: a parented companion
        /// would walk in the anchor's local space and appear to slide as the platform re-poses it.
        /// </remarks>
        public void WalkTo(Vector3 worldPosition)
        {
            if (!_isInitialized)
                return;

            if (IsAnchored)
            {
                NexaLog.Warn(LogTag,
                    "Ignored WalkTo: the companion is anchored. Detach it from its anchor before " +
                    "commanding movement.");
                return;
            }

            _moveState.SetDestination(worldPosition);
            _stateMachine.ChangeState(_moveState);
        }

        void OnDestinationReached() => _stateMachine.ChangeState(_idleState);

        bool ValidateParts()
        {
            // Fails loudly at initialisation rather than with a null reference on some later frame,
            // which on device would surface as an unexplained frozen character.
            if (_locomotion != null && _animator != null && _gaze != null && _idleMotion != null)
                return true;

            NexaLog.Error(LogTag,
                "Companion prefab is missing one or more required parts (locomotion, animator, " +
                "gaze, idle motion). The companion will not initialise.", this);
            return false;
        }
    }
}
