using System;
using Nexa.Core.Pairing;
using UnityEngine;

namespace Nexa.Pairing
{
    /// <summary>
    /// <see cref="IHeadsetCredentialStore"/> over Android Keystore-encrypted
    /// <c>SharedPreferences</c>, via the small native bridge in
    /// <c>Assets/Plugins/Android/.../HeadsetCredentialStoreBridge.java</c>. The credential-storage
    /// sibling of <see cref="AndroidHeadsetIdentity"/>, following the exact same JNI-bridge shape —
    /// see that class's own doc for the pattern this one repeats.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>DeviceCredentials</c> is serialised to a small flat JSON object with
    /// <see cref="JsonUtility"/> before crossing into Java — the bridge itself knows nothing about
    /// this C# type, only the plaintext string it encrypts and decrypts. See
    /// <c>HeadsetAdvertisementCodec</c>'s own doc for why this class does not trust a successful
    /// <c>JsonUtility.FromJson</c> call alone and validates every field explicitly afterward.
    /// </para>
    /// <para>
    /// Every Java-side call needs an Android <c>Context</c> to reach <c>SharedPreferences</c> —
    /// unlike <see cref="AndroidHeadsetIdentity"/>, whose Keystore calls need none. The running
    /// activity, read once per call via Unity's own <c>UnityPlayer.currentActivity</c>, is what is
    /// passed across the JNI boundary; an <c>Activity</c> already <i>is</i> a <c>Context</c>; no new
    /// concept is introduced by this.
    /// </para>
    /// <para>
    /// Compiled only into an Android player build — <c>UNITY_ANDROID &amp;&amp; !UNITY_EDITOR</c>,
    /// the same condition and the same reason <see cref="AndroidHeadsetIdentity"/> documents.
    /// <see cref="InMemoryHeadsetCredentialStore"/> is what the Editor and every other platform use
    /// instead, and what every test in <c>Nexa.Pairing.Tests</c> is written against.
    /// </para>
    /// </remarks>
    public sealed class AndroidHeadsetCredentialStore : IHeadsetCredentialStore
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        const string BridgeClassName = "com.nexa.companion.device.HeadsetCredentialStoreBridge";
        const string UnityPlayerClassName = "com.unity3d.player.UnityPlayer";

        readonly AndroidJavaClass _bridge = new AndroidJavaClass(BridgeClassName);

        public bool HasCredentials => CallStatic<bool>("hasCredentials", CurrentActivity());

        public void Save(DeviceCredentials credentials)
        {
            string json = JsonUtility.ToJson(new StoredCredentials
            {
                deviceId = credentials.DeviceId,
                accessToken = credentials.AccessToken,
                refreshToken = credentials.RefreshToken,
                expiresInSeconds = credentials.ExpiresInSeconds,
            });

            CallStaticVoid("save", CurrentActivity(), json);
        }

        public DeviceCredentials Load()
        {
            string json = CallStatic<string>("load", CurrentActivity());

            StoredCredentials stored;
            try
            {
                stored = JsonUtility.FromJson<StoredCredentials>(json);
            }
            catch (Exception exception)
            {
                throw new InvalidOperationException(
                    "AndroidHeadsetCredentialStore.Load(): stored credentials could not be read.", exception);
            }

            // Validated explicitly, the same defensive standard HeadsetAdvertisementCodec.TryDecode
            // holds itself to — a successful parse alone is not trusted.
            if (stored == null ||
                string.IsNullOrEmpty(stored.deviceId) ||
                string.IsNullOrEmpty(stored.accessToken) ||
                string.IsNullOrEmpty(stored.refreshToken) ||
                stored.expiresInSeconds <= 0)
            {
                throw new InvalidOperationException(
                    "AndroidHeadsetCredentialStore.Load(): stored credentials were not a genuine record.");
            }

            return new DeviceCredentials(stored.deviceId, stored.accessToken, stored.refreshToken, stored.expiresInSeconds);
        }

        public void Clear() => CallStaticVoid("clear", CurrentActivity());

        static AndroidJavaObject CurrentActivity()
        {
            using (AndroidJavaClass unityPlayer = new AndroidJavaClass(UnityPlayerClassName))
            {
                return unityPlayer.GetStatic<AndroidJavaObject>("currentActivity");
            }
        }

        T CallStatic<T>(string method, params object[] args)
        {
            try
            {
                return _bridge.CallStatic<T>(method, args);
            }
            catch (AndroidJavaException exception)
            {
                throw new InvalidOperationException(
                    $"HeadsetCredentialStoreBridge.{method} failed: {exception.Message}", exception);
            }
        }

        void CallStaticVoid(string method, params object[] args)
        {
            try
            {
                _bridge.CallStatic(method, args);
            }
            catch (AndroidJavaException exception)
            {
                throw new InvalidOperationException(
                    $"HeadsetCredentialStoreBridge.{method} failed: {exception.Message}", exception);
            }
        }

        /// <summary>The flat wire shape crossing the JNI boundary — the bridge's own plaintext, before encryption.</summary>
        [Serializable]
        sealed class StoredCredentials
        {
            public string deviceId;
            public string accessToken;
            public string refreshToken;
            public int expiresInSeconds;
        }
#else
        public bool HasCredentials => throw new InvalidOperationException(
            "AndroidHeadsetCredentialStore is only usable in an Android player build.");

        public void Save(DeviceCredentials credentials) => throw new InvalidOperationException(
            "AndroidHeadsetCredentialStore is only usable in an Android player build.");

        public DeviceCredentials Load() => throw new InvalidOperationException(
            "AndroidHeadsetCredentialStore is only usable in an Android player build.");

        public void Clear() => throw new InvalidOperationException(
            "AndroidHeadsetCredentialStore is only usable in an Android player build.");
#endif
    }
}
