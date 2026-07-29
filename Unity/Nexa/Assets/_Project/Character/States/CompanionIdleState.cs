using Nexa.Character.Animation;
using Nexa.Character.Gaze;
using Nexa.Character.Locomotion;

namespace Nexa.Character.States
{
    /// <summary>
    /// The companion stands still, faces the user and breathes.
    /// </summary>
    /// <remarks>
    /// Gaze is applied only in this state. While walking, locomotion owns rotation, and letting
    /// gaze write rotation at the same time would leave the two fighting over the transform in the
    /// same frame — a bug that presents as the companion shuddering as it moves.
    /// </remarks>
    public sealed class CompanionIdleState : ICompanionState
    {
        readonly ICompanionLocomotion _locomotion;
        readonly ICompanionAnimator _animator;
        readonly CompanionGaze _gaze;
        readonly CompanionIdleMotion _idleMotion;

        public CompanionIdleState(
            ICompanionLocomotion locomotion,
            ICompanionAnimator animator,
            CompanionGaze gaze,
            CompanionIdleMotion idleMotion)
        {
            _locomotion = locomotion;
            _animator = animator;
            _gaze = gaze;
            _idleMotion = idleMotion;
        }

        public void Enter() => _locomotion.Stop();

        public void Tick(float deltaTime)
        {
            _gaze?.Tick(deltaTime);
            _idleMotion?.Tick(deltaTime);

            // Locomotion still ticks while idle so it keeps the companion settled on the floor as
            // ARCore refines plane heights beneath a stationary character.
            _locomotion.Tick(deltaTime);

            _animator.SetLocomotionSpeed(_locomotion.NormalizedSpeed);
            _animator.SetTurnRate(_locomotion.NormalizedTurnRate);
            _animator.SetGrounded(_locomotion.IsGrounded);
        }

        public void Exit()
        {
        }
    }
}
