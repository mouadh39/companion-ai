using Nexa.Core.User;
using Unity.XR.CoreUtils;
using UnityEngine;

namespace Nexa.AR.User
{
    /// <summary>
    /// Reports the handheld device's pose as the user's head pose.
    /// </summary>
    /// <remarks>
    /// On a phone the user and the device are effectively co-located, so the AR camera stands in for
    /// the person. This equivalence is exactly what breaks on glasses — where the render cameras are
    /// offset from the head origin — and later when the companion must track other people in the
    /// room who are not holding any device. Isolating the assumption in this one class is what keeps
    /// those changes from reaching the companion.
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARCameraUserPresence : MonoBehaviour, IUserPresence
    {
        [Tooltip("XR Origin whose camera represents the user. Resolved from the scene when empty.")]
        [SerializeField] XROrigin _origin;

        [Tooltip("How far below the device the user's eyes sit, in metres. A phone is typically held " +
                 "near chest height, so aiming at the device makes the companion appear to stare at " +
                 "the user's chest. On a head-mounted display this is zero.")]
        [SerializeField, Range(-0.5f, 0.8f)] float _eyeHeightOffset = 0.25f;

        Camera _camera;

        void Awake()
        {
            if (_origin == null)
                _origin = FindAnyObjectByType<XROrigin>();

            if (_origin != null)
                _camera = _origin.Camera;
        }

        public bool IsValid => _camera != null;

        public Pose HeadPose => IsValid
            ? new Pose(_camera.transform.position, _camera.transform.rotation)
            : Pose.identity;

        public Vector3 EyeTarget
        {
            get
            {
                Vector3 head = HeadPose.position;
                head.y -= _eyeHeightOffset;
                return head;
            }
        }

        public Vector3 GetGroundPosition(float height)
        {
            Vector3 position = HeadPose.position;
            position.y = height;
            return position;
        }
    }
}
