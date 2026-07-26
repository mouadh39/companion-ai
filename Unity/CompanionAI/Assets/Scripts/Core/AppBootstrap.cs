using CompanionAI.Managers;
using UnityEngine;

namespace CompanionAI.Core
{
    /// <summary>
    /// Application entry point. Runs automatically before the first scene loads,
    /// creates core managers, verifies they initialized correctly, and logs startup info.
    /// </summary>
    public static class AppBootstrap
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Run()
        {
            LogStartupInfo();

            GameManager gameManager = GameManager.Instance;
            SceneLoader sceneLoader = SceneLoader.Instance;

            if (!DependenciesReady(gameManager, sceneLoader))
            {
                Debug.LogError("[AppBootstrap] One or more core dependencies failed to initialize.");
                return;
            }

            Debug.Log("[AppBootstrap] Bootstrap complete.");
        }

        private static bool DependenciesReady(GameManager gameManager, SceneLoader sceneLoader)
        {
            bool isReady = true;

            if (gameManager == null)
            {
                Debug.LogError("[AppBootstrap] GameManager could not be created.");
                isReady = false;
            }
            else if (!gameManager.IsInitialized)
            {
                Debug.LogError("[AppBootstrap] GameManager exists but did not complete initialization.");
                isReady = false;
            }

            if (sceneLoader == null)
            {
                Debug.LogError("[AppBootstrap] SceneLoader could not be created.");
                isReady = false;
            }

            return isReady;
        }

        private static void LogStartupInfo()
        {
            Debug.Log(
                $"[AppBootstrap] Starting {Application.productName} v{Application.version} | " +
                $"Unity {Application.unityVersion} | Platform: {Application.platform}");
        }
    }
}
