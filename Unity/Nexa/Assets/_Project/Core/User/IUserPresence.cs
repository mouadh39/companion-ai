using UnityEngine;

namespace Nexa.Core.User
{
    /// <summary>
    /// Where the human being is, in world space.
    /// </summary>
    /// <remarks>
    /// This exists so that no product code ever calls <c>Camera.main</c>. On a handheld device the
    /// user is effectively the device, so head pose is the AR camera pose. On glasses the head pose
    /// is not the render camera (there are two eye cameras, offset from the head origin), and once
    /// the companion can perceive other people in the room, "the user" becomes a tracked body that
    /// is not a camera at all. Every one of those is a different implementation behind this
    /// interface, and none of them requires touching the companion.
    /// </remarks>
    public interface IUserPresence
    {
        /// <summary>Head position and orientation in world space.</summary>
        Pose HeadPose { get; }

        /// <summary>False while the pose is not yet meaningful. Never use the pose when false.</summary>
        bool IsValid { get; }

        /// <summary>
        /// The point the companion should aim its gaze at. Slightly below the head origin so the
        /// companion meets the user's eyes rather than staring at their forehead.
        /// </summary>
        Vector3 EyeTarget { get; }

        /// <summary>Head position flattened onto the horizontal plane at <paramref name="height"/>.</summary>
        Vector3 GetGroundPosition(float height);
    }
}
