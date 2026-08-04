using System.Collections.Generic;
using UnityEngine;

namespace Nexa.Character.Animation
{
    /// <summary>
    /// Drives a Mecanim <see cref="Animator"/> from <see cref="ICompanionAnimator"/> intent.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately tolerant of a missing Animator or an incomplete controller. The project has no
    /// character rig yet, and blocking the entire AR foundation on art delivery would be the wrong
    /// dependency: every other system must be testable against a placeholder today. Once a rig
    /// arrives, wiring it up is a prefab change with no code edit.
    /// </para>
    /// <para>
    /// Parameters are resolved to hashes once and checked for existence up front, because writing
    /// to a parameter a controller does not declare logs a warning every single frame — which
    /// buries real errors and costs measurable time on device.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class MecanimCompanionAnimator : MonoBehaviour, ICompanionAnimator
    {
        /// <summary>Animator parameter names. The controller must match these exactly.</summary>
        public static class Parameters
        {
            public const string Speed = "Speed";
            public const string TurnRate = "TurnRate";
            public const string Grounded = "Grounded";
        }

        [Tooltip("Animator to drive. Resolved from this GameObject or its children when empty.")]
        [SerializeField] Animator _animator;

        [Tooltip("How quickly animation parameters chase their target values, in seconds. Smoothing " +
                 "here rather than in locomotion keeps motion logic crisp while animation stays soft.")]
        [SerializeField, Range(0f, 0.5f)] float _parameterDamping = 0.12f;

        static readonly int SpeedHash = Animator.StringToHash(Parameters.Speed);
        static readonly int TurnRateHash = Animator.StringToHash(Parameters.TurnRate);
        static readonly int GroundedHash = Animator.StringToHash(Parameters.Grounded);

        readonly HashSet<int> _declaredParameters = new HashSet<int>();
        bool _hasAnimator;

        void Awake()
        {
            if (_animator == null)
                _animator = GetComponentInChildren<Animator>();

            _hasAnimator = _animator != null && _animator.runtimeAnimatorController != null;
            if (!_hasAnimator)
                return;

            foreach (AnimatorControllerParameter parameter in _animator.parameters)
                _declaredParameters.Add(parameter.nameHash);
        }

        public void SetLocomotionSpeed(float normalizedSpeed)
        {
            if (!CanWrite(SpeedHash))
                return;

            _animator.SetFloat(SpeedHash, Mathf.Clamp01(normalizedSpeed), _parameterDamping, Time.deltaTime);
        }

        public void SetTurnRate(float normalizedTurnRate)
        {
            if (!CanWrite(TurnRateHash))
                return;

            _animator.SetFloat(TurnRateHash, Mathf.Clamp(normalizedTurnRate, -1f, 1f), _parameterDamping, Time.deltaTime);
        }

        public void SetGrounded(bool isGrounded)
        {
            if (!CanWrite(GroundedHash))
                return;

            _animator.SetBool(GroundedHash, isGrounded);
        }

        bool CanWrite(int parameterHash) => _hasAnimator && _declaredParameters.Contains(parameterHash);
    }
}
