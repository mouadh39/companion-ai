using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// A deterministic, in-memory <see cref="IHeadsetCredentialStore"/> for tests — no Android
    /// Keystore, no file system, no platform dependency of any kind. The C#/Unity counterpart to
    /// every other <c>InMemory*</c> fake in this namespace: what every test in
    /// <c>Nexa.Pairing.Tests</c> exercises instead of <c>AndroidHeadsetCredentialStore</c>.
    /// </summary>
    public sealed class InMemoryHeadsetCredentialStore : IHeadsetCredentialStore
    {
        DeviceCredentials? _stored;

        public bool HasCredentials => _stored.HasValue;

        public void Save(DeviceCredentials credentials) => _stored = credentials;

        public DeviceCredentials Load()
        {
            if (!_stored.HasValue)
            {
                throw new System.InvalidOperationException(
                    "InMemoryHeadsetCredentialStore.Load() called with nothing stored — check HasCredentials first.");
            }
            return _stored.Value;
        }

        public void Clear() => _stored = null;
    }
}
