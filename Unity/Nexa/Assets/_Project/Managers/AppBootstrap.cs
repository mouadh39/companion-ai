using Nexa.AR;
using Nexa.Core.Diagnostics;
using Nexa.Core.Input;
using Nexa.Core.Runtime;
using Nexa.Core.Services;
using Nexa.Core.Session;
using Nexa.Core.Spatial;
using Nexa.Core.User;
using Nexa.UI;
using UnityEngine;

namespace Nexa.App
{
    /// <summary>
    /// The application's composition root: brings the spatial backend online and wires the graph.
    /// </summary>
    /// <remarks>
    /// <para>
    /// One backend, and it is always real: world data comes from the device camera via AR
    /// Foundation. There is deliberately no synthetic environment behind this interface. Testing
    /// without a build is done by streaming a real device into the Editor with AR Foundation Remote,
    /// not by inventing geometry — a fabricated room would validate the app against a world that
    /// behaves nothing like the noisy, partial, continuously-revised one a camera actually reports.
    /// </para>
    /// <para>
    /// Every AR Foundation type in this project is named here or inside <c>Nexa.AR</c> and nowhere
    /// else, so adding Quest or Pico passthrough later means adding a backend, not editing the app.
    /// </para>
    /// </remarks>
    [DefaultExecutionOrder(ExecutionOrder)]
    [DisallowMultipleComponent]
    public sealed class AppBootstrap : MonoBehaviour
    {
        /// <summary>
        /// Runs before default-order components so every consumer is initialised before its first
        /// <c>Update</c>, without relying on Unity's undefined Awake ordering.
        /// </summary>
        public const int ExecutionOrder = -1000;

        const string LogTag = nameof(AppBootstrap);

        [Header("Spatial Backend")]
        [SerializeField] ARFoundationBackend _backend;

        [Header("Application")]
        [SerializeField] CompanionDirector _director;

        [Header("UI")]
        [SerializeField] ARStatusPresenter _statusPresenter;

        readonly ServiceRegistry _services = new ServiceRegistry();

        /// <summary>Application-scoped services, resolved only by this composition root.</summary>
        public ServiceRegistry Services => _services;

        /// <summary>The backend brought online at startup.</summary>
        public IXRBackend ActiveBackend { get; private set; }

        void Awake()
        {
            if (!ValidateReferences())
            {
                enabled = false;
                return;
            }

            if (!_backend.IsAvailable)
            {
                NexaLog.Error(LogTag,
                    "No XR loader is configured for this platform. Enable ARCore under " +
                    "Project Settings > XR Plug-in Management > Android, or AR Foundation Remote " +
                    "under the Desktop tab to stream a tethered device into the Editor.", this);
                enabled = false;
                return;
            }

            ActiveBackend = _backend;
            ActiveBackend.Activate();

            RegisterServices(ActiveBackend);
            InitializeConsumers();

            NexaLog.Info(LogTag, $"Application composed against: {ActiveBackend.DisplayName}");
        }

        void OnDestroy()
        {
            // Cleared explicitly so entering play mode with domain reload disabled — the default for
            // fast iteration in Unity 6 — cannot carry services over from a previous run.
            _services.Clear();
        }

        void RegisterServices(IXRBackend backend)
        {
            _services.Register<IXRBackend>(backend);
            _services.Register<IXRSessionService>(backend.Session);
            _services.Register<ISurfaceProvider>(backend.Surfaces);
            _services.Register<ISurfaceRaycaster>(backend.Raycaster);
            _services.Register<IAnchorService>(backend.Anchors);
            _services.Register<IUserPresence>(backend.User);
            _services.Register<IPlacementInput>(backend.PlacementInput);
        }

        void InitializeConsumers()
        {
            _director.Initialize(
                _services.Resolve<IPlacementInput>(),
                _services.Resolve<ISurfaceRaycaster>(),
                _services.Resolve<ISurfaceProvider>(),
                _services.Resolve<IAnchorService>(),
                _services.Resolve<IUserPresence>(),
                _services.Resolve<IXRSessionService>());

            if (_statusPresenter == null)
                return;

            _statusPresenter.Initialize(
                _services.Resolve<IXRSessionService>(),
                _services.Resolve<ISurfaceProvider>());

            // Every message the prompt shows is about getting the companion placed, so it retires
            // itself once that happens.
            _director.CompanionPlaced += _ => _statusPresenter.Dismiss();
        }

        bool ValidateReferences()
        {
            // Checked as a batch so a misconfigured scene reports everything missing in one pass,
            // rather than one field per run.
            bool valid = true;

            if (_backend == null)
            {
                NexaLog.Error(LogTag, "No spatial backend assigned.", this);
                valid = false;
            }

            if (_director == null)
            {
                NexaLog.Error(LogTag, "No companion director assigned.", this);
                valid = false;
            }

            return valid;
        }
    }
}
