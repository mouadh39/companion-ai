using System;
using Nexa.Core.Input;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;

namespace Nexa.Input
{
    /// <summary>
    /// Turns a screen tap or mouse click into a world-space <see cref="PointerRay"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This lives outside the AR assembly on purpose: a screen tap is a property of the *display*,
    /// not of AR. The same component serves a real device, AR Foundation Remote, XR Simulation and
    /// the pure Editor simulation — the only thing that differs is which camera converts the screen
    /// point into a ray, and that is injected via <see cref="SetCamera"/> by whichever backend is
    /// active.
    /// </para>
    /// <para>
    /// A tap is deliberately distinguished from a drag and a long press. Users pan and pinch-zoom
    /// constantly while framing an AR shot, and treating every touch release as a placement command
    /// makes the companion teleport during ordinary camera movement.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ScreenTapPlacementInput : MonoBehaviour, IPlacementInput
    {
        [Tooltip("Longest press, in seconds, still treated as a tap rather than a hold.")]
        [SerializeField, Range(0.05f, 1.5f)] float _maxTapDuration = 0.5f;

        [Tooltip("Furthest the finger may travel, as a fraction of screen height, and still count " +
                 "as a tap. Expressed relative to screen size so behaviour is identical across " +
                 "device resolutions and DPIs.")]
        [SerializeField, Range(0.005f, 0.2f)] float _maxTapTravelFraction = 0.03f;

        [Tooltip("Ignore taps that land on interactive UI. Without this, pressing an on-screen " +
                 "button also sends the companion to whatever is behind it.")]
        [SerializeField] bool _blockedByUI = true;

        Camera _camera;
        Vector2 _pressPosition;
        float _pressTime;
        bool _pressActive;

        public event Action<PointerRay> Confirmed;

        public bool Enabled { get; set; } = true;

        /// <summary>
        /// Supplies the camera used to project screen points into the world. Called by the active
        /// backend during activation.
        /// </summary>
        public void SetCamera(Camera camera) => _camera = camera;

        void Update()
        {
            if (!Enabled || _camera == null)
            {
                // Any press in flight is abandoned rather than completed, so re-enabling input
                // mid-gesture cannot deliver a tap the user began before it was allowed.
                _pressActive = false;
                return;
            }

            if (!TryReadPointer(out Vector2 position, out bool pressedThisFrame, out bool releasedThisFrame))
                return;

            if (pressedThisFrame)
                BeginPress(position);
            else if (releasedThisFrame && _pressActive)
                EndPress(position);
        }

        void BeginPress(Vector2 position)
        {
            if (_blockedByUI && IsPointerOverUI())
            {
                _pressActive = false;
                return;
            }

            _pressActive = true;
            _pressPosition = position;
            _pressTime = Time.unscaledTime;
        }

        void EndPress(Vector2 position)
        {
            _pressActive = false;

            if (Time.unscaledTime - _pressTime > _maxTapDuration)
                return;

            float maxTravelPixels = Screen.height * _maxTapTravelFraction;
            if (Vector2.Distance(position, _pressPosition) > maxTravelPixels)
                return;

            Confirmed?.Invoke(new PointerRay(_camera.ScreenPointToRay(position)));
        }

        /// <summary>
        /// Reads the active pointer, preferring touch and falling back to mouse.
        /// </summary>
        /// <remarks>
        /// The mouse path is what makes the Editor workflow work: it drives the identical placement
        /// pipeline the phone drives, so behaviour verified in the Editor is the behaviour shipped.
        /// It costs nothing on device, where there is no <c>Mouse.current</c>.
        /// </remarks>
        static bool TryReadPointer(out Vector2 position, out bool pressedThisFrame, out bool releasedThisFrame)
        {
            position = default;
            pressedThisFrame = false;
            releasedThisFrame = false;

            Touchscreen touchscreen = Touchscreen.current;
            if (touchscreen != null)
            {
                ButtonControl press = touchscreen.primaryTouch.press;
                if (press.isPressed || press.wasReleasedThisFrame)
                {
                    position = touchscreen.primaryTouch.position.ReadValue();
                    pressedThisFrame = press.wasPressedThisFrame;
                    releasedThisFrame = press.wasReleasedThisFrame;
                    return true;
                }
            }

            Mouse mouse = Mouse.current;
            if (mouse != null)
            {
                ButtonControl button = mouse.leftButton;
                if (button.isPressed || button.wasReleasedThisFrame)
                {
                    position = mouse.position.ReadValue();
                    pressedThisFrame = button.wasPressedThisFrame;
                    releasedThisFrame = button.wasReleasedThisFrame;
                    return true;
                }
            }

            return false;
        }

        static bool IsPointerOverUI() =>
            EventSystem.current != null && EventSystem.current.IsPointerOverGameObject();
    }
}
