using Nexa.Core.Diagnostics;

namespace Nexa.Character.States
{
    /// <summary>
    /// Runs exactly one <see cref="ICompanionState"/> at a time.
    /// </summary>
    public sealed class CompanionStateMachine
    {
        const string LogTag = nameof(CompanionStateMachine);

        public ICompanionState Current { get; private set; }

        /// <summary>
        /// Transitions to <paramref name="next"/>, exiting the current state first.
        /// </summary>
        /// <remarks>
        /// Re-entering the state that is already running is treated as a no-op rather than as an
        /// exit/enter pair. Otherwise a caller that re-asserts a state each frame would restart it
        /// continuously, resetting any timers the state owns.
        /// </remarks>
        public void ChangeState(ICompanionState next)
        {
            if (next == null)
            {
                NexaLog.Warn(LogTag, "Refused a transition to a null state.");
                return;
            }

            if (ReferenceEquals(Current, next))
                return;

            Current?.Exit();
            Current = next;
            Current.Enter();
        }

        public void Tick(float deltaTime) => Current?.Tick(deltaTime);
    }
}
