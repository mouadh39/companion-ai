using Nexa.Character.Animation;
using Nexa.Character.Locomotion;
using UnityEngine;

namespace Nexa.Character.States
{
    /// <summary>
    /// The companion walks to a commanded destination.
    /// </summary>
    public sealed class CompanionMoveState : ICompanionState
    {
        readonly ICompanionLocomotion _locomotion;
        readonly ICompanionAnimator _animator;
        readonly CompanionIdleMotion _idleMotion;

        Vector3 _destination;

        public CompanionMoveState(
            ICompanionLocomotion locomotion,
            ICompanionAnimator animator,
            CompanionIdleMotion idleMotion)
        {
            _locomotion = locomotion;
            _animator = animator;
            _idleMotion = idleMotion;
        }

        /// <summary>
        /// Sets the destination used on the next <see cref="Enter"/>, and redirects immediately if
        /// the companion is already walking. Lets the user re-tap mid-walk without a state cycle.
        /// </summary>
        public void SetDestination(Vector3 worldPosition)
        {
            _destination = worldPosition;
            _locomotion.MoveTo(worldPosition);
        }

        public void Enter() => _locomotion.MoveTo(_destination);

        public void Tick(float deltaTime)
        {
            _locomotion.Tick(deltaTime);

            // Breathing continues while walking; a character that stops breathing the moment it
            // moves is a character the eye reads as animating rather than living.
            _idleMotion?.Tick(deltaTime);

            _animator.SetLocomotionSpeed(_locomotion.NormalizedSpeed);
            _animator.SetTurnRate(_locomotion.NormalizedTurnRate);
            _animator.SetGrounded(_locomotion.IsGrounded);
        }

        public void Exit() => _locomotion.Stop();
    }
}
