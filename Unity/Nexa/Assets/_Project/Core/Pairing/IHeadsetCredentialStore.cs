namespace Nexa.Core.Pairing
{
    /// <summary>
    /// Persists this headset's <see cref="DeviceCredentials"/> across process restarts — the one
    /// thing a freshly-redeemed headset needs to remember so it does not have to pair again every
    /// time the app starts.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately narrow: this interface knows about exactly one type,
    /// <see cref="DeviceCredentials"/>. It has no method that takes or returns a private key, a
    /// challenge, or a signature — nothing about <c>IHeadsetIdentity</c> or Android Keystore reaches
    /// this interface at all, and a concrete implementation has no reason to import either. That is
    /// the actual safety property this split buys: a store that physically cannot be handed key
    /// material cannot leak it alongside a device credential, whatever storage mechanism it ends up
    /// using underneath.
    /// </para>
    /// <para>
    /// This is also why a device credential and the private key are never, on either platform,
    /// written to the same underlying store. Android Keystore already refuses to export the
    /// private key by construction (see <c>AndroidHeadsetIdentity</c>'s own doc); a concrete
    /// implementation of this interface is a second, independent mechanism, specifically so the two
    /// secrets' storage never shares a single point of failure.
    /// </para>
    /// </remarks>
    public interface IHeadsetCredentialStore
    {
        /// <summary>Whether credentials are currently stored, without reading them.</summary>
        bool HasCredentials { get; }

        /// <summary>
        /// Replaces whatever is stored with <paramref name="credentials"/>. A second call
        /// overwrites the first — this store holds at most one headset's credentials, matching
        /// <c>IHeadsetIdentity</c>'s own one-key-per-install model.
        /// </summary>
        void Save(DeviceCredentials credentials);

        /// <summary>
        /// Reads the stored credentials. Throws if <see cref="HasCredentials"/> is <c>false</c> —
        /// callers check that first, the same contract <c>IHeadsetIdentity.PublicKeySpkiDer</c>
        /// documents for the same reason.
        /// </summary>
        DeviceCredentials Load();

        /// <summary>Discards whatever is stored. Safe to call whether or not anything was stored.</summary>
        void Clear();
    }
}
