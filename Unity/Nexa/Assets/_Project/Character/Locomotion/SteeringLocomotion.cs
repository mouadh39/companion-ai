using System;
using Nexa.Core.Spatial;
using Nexa.Data.Companion;
using UnityEngine;

namespace Nexa.Character.Locomotion
{
    /// <summary>
    /// Moves the companion by steering it toward a destination and keeping it on detected ground.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The companion walks along its own facing rather than sliding straight at the destination.
    /// That single choice produces the natural arc a person makes when redirecting, instead of the
    /// crab-walk that direct interpolation gives. When the destination is far enough off-axis the
    /// companion turns on the spot first, as a person would.
    /// </para>
    /// <para>
    /// This implementation is intentionally obstacle-unaware — it is the milestone-one stand-in
    /// behind <see cref="ICompanionLocomotion"/>, not the final navigation system. It does, however,
    /// already track real floor height, so it will not walk through the air over a detected step.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class SteeringLocomotion : MonoBehaviour, ICompanionLocomotion
    {
        CompanionLocomotionConfig _config;
        ISurfaceProvider _surfaces;

        Vector3 _destination;
        bool _hasDestination;
        float _currentSpeed;
        float _currentTurnRate;
        bool _groundAdherenceEnabled = true;

        public event Action DestinationReached;

        public bool IsMoving => _hasDestination;

        public float NormalizedSpeed => _config != null && _config.MoveSpeed > 0f
            ? Mathf.Clamp01(_currentSpeed / _config.MoveSpeed)
            : 0f;

        public float NormalizedTurnRate => _config != null && _config.AngularSpeed > 0f
            ? Mathf.Clamp(_currentTurnRate / _config.AngularSpeed, -1f, 1f)
            : 0f;

        public bool IsGrounded { get; private set; }

        /// <summary>
        /// Supplies dependencies. Called by the composition root; this component never resolves
        /// anything itself, which is what keeps it unit-testable with a fake surface provider.
        /// </summary>
        /// <param name="config">Movement tuning.</param>
        /// <param name="surfaces">
        /// Ground source. May be null, in which case the companion holds its placement height —
        /// useful for editor testing without an AR session.
        /// </param>
        public void Initialize(CompanionLocomotionConfig config, ISurfaceProvider surfaces)
        {
            _config = config != null
                ? config
                : throw new ArgumentNullException(nameof(config));

            _surfaces = surfaces;
        }

        public void SetGroundAdherence(bool enabled)
        {
            _groundAdherenceEnabled = enabled;

            // An anchored companion is grounded by definition — it was anchored to a surface the
            // platform detected. Reporting otherwise would make the animator play a fall or float
            // state for a character that is standing perfectly still on a real floor.
            if (!enabled)
                IsGrounded = true;
        }

        public void MoveTo(Vector3 worldPosition)
        {
            _destination = worldPosition;
            _hasDestination = true;
        }

        public void Stop()
        {
            _hasDestination = false;
            _currentSpeed = 0f;
            _currentTurnRate = 0f;
        }

        public void Warp(Pose pose)
        {
            Stop();
            transform.SetPositionAndRotation(pose.position, pose.rotation);
        }

        public void Tick(float deltaTime)
        {
            if (_config == null || deltaTime <= 0f)
                return;

            if (_hasDestination)
                AdvanceTowardDestination(deltaTime);
            else
                Decelerate(deltaTime);

            if (_groundAdherenceEnabled)
                AdhereToGround(deltaTime);
        }

        void AdvanceTowardDestination(float deltaTime)
        {
            Vector3 toDestination = _destination - transform.position;
            toDestination.y = 0f;

            float distance = toDestination.magnitude;
            if (distance <= _config.ArrivalTolerance)
            {
                Arrive();
                return;
            }

            Vector3 direction = toDestination / distance;
            float headingError = Vector3.SignedAngle(transform.forward, direction, Vector3.up);

            RotateToward(direction, deltaTime);

            // Walking begins only once roughly aligned. Moving while badly misaligned is what
            // produces the wide unnatural sweep characteristic of naive steering.
            float targetSpeed = Mathf.Abs(headingError) > _config.TurnInPlaceAngle ? 0f : _config.MoveSpeed;
            _currentSpeed = Mathf.MoveTowards(_currentSpeed, targetSpeed, _config.Acceleration * deltaTime);

            // Never overshoot the destination within a single frame, which would cause the
            // companion to oscillate around it at low frame rates.
            float step = Mathf.Min(_currentSpeed * deltaTime, distance);
            transform.position += transform.forward * step;
        }

        void Decelerate(float deltaTime)
        {
            _currentSpeed = Mathf.MoveTowards(_currentSpeed, 0f, _config.Acceleration * deltaTime);
            _currentTurnRate = Mathf.MoveTowards(_currentTurnRate, 0f, _config.AngularSpeed * deltaTime);

            if (_currentSpeed > 0f)
                transform.position += transform.forward * (_currentSpeed * deltaTime);
        }

        void RotateToward(Vector3 direction, float deltaTime)
        {
            Quaternion target = Quaternion.LookRotation(direction, Vector3.up);
            Quaternion previous = transform.rotation;

            transform.rotation = Quaternion.RotateTowards(previous, target, _config.AngularSpeed * deltaTime);

            float appliedDegrees = Quaternion.Angle(previous, transform.rotation);
            float signedDegrees = Vector3.SignedAngle(previous * Vector3.forward, transform.forward, Vector3.up);

            _currentTurnRate = Mathf.Approximately(deltaTime, 0f)
                ? 0f
                : Mathf.Sign(signedDegrees) * appliedDegrees / deltaTime;
        }

        void Arrive()
        {
            _hasDestination = false;
            _currentSpeed = 0f;
            DestinationReached?.Invoke();
        }

        void AdhereToGround(float deltaTime)
        {
            if (_surfaces == null)
            {
                IsGrounded = true;
                return;
            }

            if (!_surfaces.TryGetSurfaceHeight(transform.position, SurfaceType.Walkable, out float height))
            {
                // Off the edge of everything the device has mapped. The companion holds its current
                // height rather than falling: an unmapped region is far more often a gap in scanning
                // than an actual drop.
                IsGrounded = false;
                return;
            }

            IsGrounded = true;

            // Eased rather than snapped: ARCore revises plane height continuously, and applying
            // those revisions instantly makes the companion visibly vibrate.
            Vector3 position = transform.position;
            position.y = Mathf.MoveTowards(position.y, height, _config.GroundSettleSpeed * deltaTime);
            transform.position = position;
        }
    }
}
