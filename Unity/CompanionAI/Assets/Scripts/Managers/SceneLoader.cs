using System;
using System.Collections;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace CompanionAI.Managers
{
    /// <summary>
    /// Handles asynchronous scene transitions with progress reporting and
    /// guards against overlapping or invalid loads.
    /// </summary>
    public class SceneLoader : MonoBehaviour
    {
        /// <summary>
        /// Unity reports async scene load progress up to 0.9 while the scene is
        /// prepared, then holds there until activation is allowed.
        /// </summary>
        private const float SceneReadyProgress = 0.9f;

        private static SceneLoader _instance;

        /// <summary>
        /// Global access point. Creates a persistent instance on first use if none exists yet.
        /// </summary>
        public static SceneLoader Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = FindFirstObjectByType<SceneLoader>();

                    if (_instance == null)
                    {
                        var ownerObject = new GameObject(nameof(SceneLoader));
                        _instance = ownerObject.AddComponent<SceneLoader>();
                    }
                }

                return _instance;
            }
        }

        /// <summary>True while a scene load is in progress.</summary>
        public bool IsLoading { get; private set; }

        private void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);
        }

        /// <summary>
        /// Loads a scene by name asynchronously.
        /// </summary>
        /// <param name="sceneName">Name of the scene, as registered in Build Settings.</param>
        /// <param name="onProgress">Optional callback invoked with normalized progress (0-1).</param>
        /// <param name="onComplete">Optional callback invoked once the scene has fully activated.</param>
        public void LoadScene(string sceneName, Action<float> onProgress = null, Action onComplete = null)
        {
            if (string.IsNullOrEmpty(sceneName))
            {
                Debug.LogError("[SceneLoader] Cannot load scene: scene name is null or empty.");
                return;
            }

            if (IsLoading)
            {
                Debug.LogError($"[SceneLoader] Cannot load '{sceneName}': another scene load is already in progress.");
                return;
            }

            StartCoroutine(LoadSceneRoutine(sceneName, onProgress, onComplete));
        }

        private IEnumerator LoadSceneRoutine(string sceneName, Action<float> onProgress, Action onComplete)
        {
            IsLoading = true;

            AsyncOperation operation = SceneManager.LoadSceneAsync(sceneName);

            if (operation == null)
            {
                Debug.LogError($"[SceneLoader] Failed to start loading scene '{sceneName}'. Verify it is added to Build Settings.");
                IsLoading = false;
                yield break;
            }

            operation.allowSceneActivation = false;

            while (operation.progress < SceneReadyProgress)
            {
                onProgress?.Invoke(operation.progress / SceneReadyProgress);
                yield return null;
            }

            onProgress?.Invoke(1f);
            operation.allowSceneActivation = true;

            while (!operation.isDone)
            {
                yield return null;
            }

            IsLoading = false;
            onComplete?.Invoke();
        }
    }
}
