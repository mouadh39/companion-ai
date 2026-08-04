using Nexa.Core.User;
using Nexa.Data.Companion;
using UnityEngine;

namespace Nexa.Character.Gaze
{
    /// <summary>
    /// Turns the companion to face the user.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Whole-body yaw only, for now. Once a rig exists this becomes the driver for a layered
    /// head-and-eyes look-at, where the body turns only after the head reaches its comfortable
    /// limit — which is how people actually orient toward someone.
    /// </para>
    /// <para>
    /// The deadzone is the detail that decides whether the companion reads as calm or twitchy. A
    /// handheld device never stops moving: hand tremor alone swings the reported pose by a degree
    /// or two continuously. Without a deadzone the companion chases that noise forever and looks
    /// anxious. Hysteresis is applied on top so it does not oscillate at the deadzone boundary.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class CompanionGaze : MonoBehaviour
    {
        /// <summary>
        /// Fraction of the deadzone the companion must close to before it stops correcting. Turning
        /// off exactly at the boundary leaves it poised to re-trigger on the next tremor.
        /// </summary>
        const float SettleFraction = 0.25f;

        IUserPresence _user;
        CompanionPresenceConfig _config;
        bool _isCorrecting;
        bool _isArriving;

        /// <summary>True when the companion is within its deadzone of the user's direction.</summary>
        public bool IsFacingUser { get; private set; } = true;

        /// <summary>
        /// True while the companion is performing its first turn toward the user after placement.
        /// Clears the moment that turn completes and never returns.
        /// </summary>
        public bool IsArriving => _isArriving;

        public void Initialize(IUserPresence user, CompanionPresenceConfig config)
        {
            _user = user;
            _config = config;
        }

        /// <summary>
        /// Marks the next turn as the arrival turn, taken at the slower
        /// <see cref="CompanionPresenceConfig.ArrivalTurnSpeed"/>.
        /// </summary>
        /// <remarks>
        /// Separate from ordinary gaze because the two mean different things to the viewer. Ongoing
        /// gaze is a correction the user should barely register; the arrival turn is the companion
        /// noticing them, and is the single beat that decides whether it reads as someone showing up
        /// or as an asset being instantiated. Running both at the same speed loses that.
        /// </remarks>
        public void BeginArrival()
        {
            _isArriving = true;
            _isCorrecting = true;
            IsFacingUser = false;
        }

        /// <summary>
        /// Advances the turn. Driven by the owning state so that gaze applies only when the
        /// companion is not being steered by locomotion — two systems writing rotation in the same
        /// frame would fight.
        /// </summary>
        public void Tick(float deltaTime)
        {
            if (_user == null || _config == null || !_user.IsValid || deltaTime <= 0f)
                return;

            Vector3 toUser = _user.EyeTarget - transform.position;
            toUser.y = 0f;

            // Directly beneath or above the user there is no meaningful yaw to adopt.
            if (toUser.sqrMagnitude < 1e-006f)
                return;

            Vector3 direction = toUser.normalized;
            float error = Mathf.Abs(Vector3.SignedAngle(transform.forward, direction, Vector3.up));

            if (_isCorrecting)
            {
                if (error <= _config.GazeDeadzoneAngle * SettleFraction)
                {
                    _isCorrecting = false;

                    // The arrival turn is over once the companion first settles on the user. From
                    // here every turn is an ordinary correction.
                    _isArriving = false;
                }
            }
            else if (error > _config.GazeDeadzoneAngle)
            {
                _isCorrecting = true;
            }

            IsFacingUser = !_isCorrecting;
            if (!_isCorrecting)
                return;

            float turnSpeed = _isArriving ? _config.ArrivalTurnSpeed : _config.BodyTurnSpeed;

            Quaternion target = Quaternion.LookRotation(direction, Vector3.up);
            transform.rotation = Quaternion.RotateTowards(
                transform.rotation, target, turnSpeed * deltaTime);
        }
    }
}
