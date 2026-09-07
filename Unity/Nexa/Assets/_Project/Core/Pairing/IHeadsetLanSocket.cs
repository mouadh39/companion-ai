using System;

namespace Nexa.Core.Pairing
{
    /// <summary>One datagram this socket accepted past its own hostile-network guards.</summary>
    public readonly struct LanDatagram
    {
        public LanDatagram(byte[] payload, string senderAddress, int senderPort)
        {
            Payload = payload;
            SenderAddress = senderAddress;
            SenderPort = senderPort;
        }

        /// <summary>The raw bytes received — untrusted, exactly as they arrived on the wire.</summary>
        public byte[] Payload { get; }

        /// <summary>The sending endpoint's IP address, as text (e.g. <c>"192.168.1.42"</c>).</summary>
        public string SenderAddress { get; }

        /// <summary>The sending endpoint's UDP port.</summary>
        public int SenderPort { get; }
    }

    /// <summary>
    /// The platform-neutral half of Nexa's local pairing transport on the headset side — the
    /// C#/Unity counterpart to <c>LanDiscoverySocket</c> in <c>apps/flutter-client</c>, and
    /// exactly as narrow: getting bytes across a hostile local network safely, with no opinion on
    /// what those bytes mean.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is the seam a concrete transport (real UDP today; see <c>Nexa.Pairing</c> for both a
    /// real implementation and a deterministic in-memory fake for tests) plugs into, and the only
    /// thing anything in <c>Nexa.Pairing</c> that interprets a message — <c>PairingLanEnvelope</c>,
    /// <c>HeadsetAdvertisementCodec</c> — depends on. Nothing here knows what an advertisement, a
    /// pairing code, or a headset identity is.
    /// </para>
    /// <para>
    /// Callback-based, matching this project's own established shape (<c>ICompanionBackend.Send</c>,
    /// <c>IHeadsetQrScanner</c>) rather than the C# event/delegate pattern — a receiving socket is
    /// a continuous source, not a one-shot call, the same reasoning <c>IHeadsetQrScanner</c>'s own
    /// doc gives for the same choice.
    /// </para>
    /// </remarks>
    public interface IHeadsetLanSocket
    {
        /// <summary>Whether <see cref="Open"/> has succeeded and <see cref="Close"/> has not since been called.</summary>
        bool IsOpen { get; }

        /// <summary>
        /// Binds on <paramref name="port"/>. Safe to call again at any time, including while
        /// already open — a fresh call always tears down and replaces whatever came before it
        /// first, the same reconnect guarantee <c>LanDiscoverySocket.open</c> documents.
        /// </summary>
        void Open(int port);

        /// <summary>Closes the socket and stops receiving. Idempotent — safe whether or not <see cref="Open"/> ever succeeded.</summary>
        void Close();

        /// <summary>
        /// Begins delivering every datagram this socket accepts to <paramref name="onDatagram"/>,
        /// one call per datagram, for as long as receiving continues.
        /// </summary>
        void StartReceiving(Action<LanDatagram> onDatagram);

        /// <summary>Stops delivering datagrams. Safe to call whether or not receiving is active.</summary>
        void StopReceiving();

        /// <summary>
        /// Sends <paramref name="payload"/> as a single datagram to <paramref name="address"/>:<paramref name="port"/> —
        /// unicast to an address already known, or a broadcast address the caller supplies
        /// explicitly. This interface has no separate "broadcast" method: broadcasting is simply
        /// sending to a broadcast address, a decision left to the caller, not this abstraction.
        /// </summary>
        void Send(byte[] payload, string address, int port);
    }
}
