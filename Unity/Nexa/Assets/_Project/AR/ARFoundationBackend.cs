using System.Collections.Generic;
using Nexa.AR.Session;
using Nexa.AR.Spatial;
using Nexa.AR.User;
using Nexa.Core.Diagnostics;
using Nexa.Core.Input;
using Nexa.Core.Runtime;
using Nexa.Core.Session;
using Nexa.Core.Spatial;
using Nexa.Core.User;
using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.XR.Management;

namespace Nexa.AR
{
    /// <summary>
    /// Supplies spatial services from real AR Foundation subsystems.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This one backend covers every environment where genuine AR Foundation subsystems exist:
    /// an Android device, <b>AR Foundation Remote</b> streaming from a tethered phone, and Unity's
    /// built-in XR Simulation. All three register an XR loader and expose identical subsystems, so
    /// none of them needs special-casing here — which is precisely why adopting AR Foundation Remote
    /// requires no code change at all, only a loader selection in project settings.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class ARFoundationBackend : MonoBehaviour, IXRBackend
    {
        const string LogTag = nameof(ARFoundationBackend);

        [Header("AR Rig")]
        [Tooltip("Root objects switched off when this backend is not selected, so a dormant AR " +
                 "session cannot fight the simulated one for the camera.")]
        [SerializeField] GameObject[] _rigObjects;

        [SerializeField] XROrigin _origin;

        [Header("Services")]
        [SerializeField] ARFoundationSessionService _session;
        [SerializeField] ARFoundationSurfaceProvider _surfaces;
        [SerializeField] ARFoundationSurfaceRaycaster _raycaster;
        [SerializeField] ARFoundationAnchorService _anchors;
        [SerializeField] ARCameraUserPresence _user;
        [SerializeField] Nexa.Input.ScreenTapPlacementInput _placementInput;

        public string DisplayName => "AR Foundation (device / AR Foundation Remote / XR Simulation)";

        public IXRSessionService Session => _session;
        public ISurfaceProvider Surfaces => _surfaces;
        public ISurfaceRaycaster Raycaster => _raycaster;
        public IAnchorService Anchors => _anchors;
        public IUserPresence User => _user;
        public IPlacementInput PlacementInput => _placementInput;

        /// <summary>
        /// True when XR Plug-in Management has a loader configured for the running platform.
        /// </summary>
        /// <remarks>
        /// The *configured* loader list is checked rather than the started loader, because XR
        /// initialisation races application startup: at the moment the composition root runs, a
        /// valid loader may be configured but not yet begun. Testing the configured list gives a
        /// stable answer on the first frame.
        /// </remarks>
        public bool IsAvailable
        {
            get
            {
                XRGeneralSettings settings = XRGeneralSettings.Instance;
                if (settings == null || settings.Manager == null)
                    return false;

                IReadOnlyList<XRLoader> loaders = settings.Manager.activeLoaders;
                return loaders != null && loaders.Count > 0;
            }
        }

        public void Activate()
        {
            SetRigActive(true);

            Camera camera = _origin != null ? _origin.Camera : null;
            if (camera == null)
                NexaLog.Error(LogTag, "XR Origin has no camera; screen taps cannot be projected.", this);
            else if (_placementInput != null)
                _placementInput.SetCamera(camera);

            NexaLog.Info(LogTag, "Activated.");
        }

        public void Deactivate() => SetRigActive(false);

        void SetRigActive(bool active)
        {
            if (_rigObjects == null)
                return;

            for (int i = 0; i < _rigObjects.Length; i++)
            {
                if (_rigObjects[i] != null)
                    _rigObjects[i].SetActive(active);
            }
        }
    }
}
