namespace Nexa.Character.Animation
{
    /// <summary>
    /// The companion's animation surface, expressed as intent rather than as clips.
    /// </summary>
    /// <remarks>
    /// Callers say what the companion is <i>doing</i>; the implementation decides how that is
    /// rendered. Today that is a Mecanim blend tree. It could later be a procedural or ML-driven
    /// animation system, and the state machine driving it will not change. Equally important, it
    /// keeps every <c>Animator</c> parameter string in one file instead of scattered across
    /// behaviours where a typo fails silently.
    /// </remarks>
    public interface ICompanionAnimator
    {
        /// <summary>
        /// Current travel speed as a fraction of the companion's maximum, in the range 0 to 1.
        /// Drives the idle/walk/run blend.
        /// </summary>
        void SetLocomotionSpeed(float normalizedSpeed);

        /// <summary>
        /// Current turn rate as a signed fraction of maximum, in the range -1 to 1. Negative turns
        /// left. Drives lean and turn-on-the-spot animation.
        /// </summary>
        void SetTurnRate(float normalizedTurnRate);

        /// <summary>Whether the companion is currently standing on a known surface.</summary>
        void SetGrounded(bool isGrounded);
    }
}
