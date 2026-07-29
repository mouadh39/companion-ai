namespace Nexa.Character.States
{
    /// <summary>
    /// One mode of companion behaviour.
    /// </summary>
    /// <remarks>
    /// States are plain C# objects rather than MonoBehaviours: they are allocated once when the
    /// companion spawns, carry no Unity lifecycle, and can be exercised in edit-mode tests without
    /// a scene. This is the extension point through which later behaviour — greeting, listening,
    /// speaking, following, reacting — enters the system without any state knowing about the others.
    /// </remarks>
    public interface ICompanionState
    {
        void Enter();

        void Tick(float deltaTime);

        void Exit();
    }
}
