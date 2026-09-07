namespace Nexa.Core.Pairing
{
    /// <summary>
    /// What a successful redemption hands this headset: its own device id, and the one-time
    /// access/refresh token pair <c>POST /v1/pairing-sessions/redeem</c> returns. The C#/Unity
    /// mirror of <c>apps/flutter-client</c>'s <c>DeviceCredentials</c> — same four fields, same
    /// reasoning for why they exist as one type rather than four loose values passed around
    /// together.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is an application credential — proof this headset is now a device on an account. It is
    /// never the private key <c>IHeadsetIdentity</c> holds, and the two must never be stored
    /// together: see <see cref="IHeadsetCredentialStore"/>'s own doc on why a store that only ever
    /// touches this type can never be handed key material to leak, even by a caller's mistake.
    /// </para>
    /// </remarks>
    public readonly struct DeviceCredentials
    {
        public DeviceCredentials(string deviceId, string accessToken, string refreshToken, int expiresInSeconds)
        {
            DeviceId = deviceId;
            AccessToken = accessToken;
            RefreshToken = refreshToken;
            ExpiresInSeconds = expiresInSeconds;
        }

        public string DeviceId { get; }

        /// <summary>The headset's <c>nexa-device</c> access JWT. Never logged; see every caller's own doc.</summary>
        public string AccessToken { get; }

        /// <summary>Plaintext, valid for exactly one further refresh. Same handling rules as <see cref="AccessToken"/>.</summary>
        public string RefreshToken { get; }

        public int ExpiresInSeconds { get; }

        /// <summary>Deliberately never includes either token — only <see cref="DeviceId"/>, which is not secret.</summary>
        public override string ToString() =>
            $"DeviceCredentials(deviceId: {DeviceId}, accessToken: <redacted>, refreshToken: <redacted>, expiresInSeconds: {ExpiresInSeconds})";
    }
}
