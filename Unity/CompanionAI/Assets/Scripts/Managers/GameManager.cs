using UnityEngine;

namespace CompanionAI.Managers
{
    /// <summary>
    /// Central singleton that owns high-level application state and initialization.
    /// Persists for the lifetime of the application.
    /// </summary>
    public class GameManager : MonoBehaviour
    {
        private static GameManager _instance;

        /// <summary>
        /// Global access point. Creates a persistent instance on first use if none exists yet.
        /// </summary>
        public static GameManager Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = FindFirstObjectByType<GameManager>();

                    if (_instance == null)
                    {
                        var ownerObject = new GameObject(nameof(GameManager));
                        _instance = ownerObject.AddComponent<GameManager>();
                    }
                }

                return _instance;
            }
        }

        /// <summary>True once <see cref="Initialize"/> has run successfully.</summary>
        public bool IsInitialized { get; private set; }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);

            Initialize();
        }

        /// <summary>
        /// Performs one-time startup setup. Safe to call multiple times; only runs once.
        /// </summary>
        public void Initialize()
        {
            if (IsInitialized)
            {
                return;
            }

            IsInitialized = true;
            Debug.Log("[GameManager] Initialized.");
        }
    }
}
