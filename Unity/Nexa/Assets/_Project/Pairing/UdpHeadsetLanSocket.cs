using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// A real UDP <see cref="IHeadsetLanSocket"/> — <see cref="System.Net.Sockets.UdpClient"/>
    /// underneath, nothing else. The headset-side counterpart to
    /// <c>apps/flutter-client</c>'s <c>LanDiscoverySocket</c>, built to the same hostile-network
    /// guards: oversized datagrams dropped before being handed to a caller, an exact repeat from
    /// the same sender within a short window suppressed, graceful open/close/reconnect.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Written to the same standard, conservatively long-established .NET networking API
    /// (<c>UdpClient</c>, <c>async</c>/<c>await</c> over <c>ReceiveAsync</c>) this codebase's
    /// other unverifiable-in-this-environment classes already rely on — but, exactly like those,
    /// this class has NOT been compiled or run: no Unity Editor matching this project's version is
    /// available in this environment. See the report for exactly what that means here.
    /// </para>
    /// <para>
    /// The receive loop is a single background <c>async</c> task started by
    /// <see cref="StartReceiving"/> and stopped by cancelling <see cref="_receiveLoopCancellation"/>
    /// — not a Unity <c>Update</c>-driven poll, since a blocking (awaited) socket read has nothing
    /// to do with the render loop and gains nothing from being tied to it. Every datagram this
    /// receives is still handed to its callback on whatever thread the awaited continuation
    /// resumes on, which for <c>UdpClient.ReceiveAsync</c> is a thread-pool thread, not Unity's
    /// main thread — a caller that needs to touch Unity APIs (a <c>GameObject</c>, a
    /// <c>MonoBehaviour</c>'s own state) from its callback is responsible for marshalling back to
    /// the main thread itself; this class does not do that on anyone's behalf, the same way
    /// <c>IHeadsetQrScanner</c> makes no promise about which thread its own callback runs on.
    /// </para>
    /// </remarks>
    public sealed class UdpHeadsetLanSocket : IHeadsetLanSocket
    {
        public UdpHeadsetLanSocket(int maxDatagramBytes = 4096, double dedupWindowSeconds = 2.0)
        {
            _maxDatagramBytes = maxDatagramBytes;
            _dedupWindow = TimeSpan.FromSeconds(dedupWindowSeconds);
        }

        readonly int _maxDatagramBytes;
        readonly TimeSpan _dedupWindow;
        readonly Dictionary<string, DateTime> _recentDigests = new Dictionary<string, DateTime>();

        UdpClient _client;
        CancellationTokenSource _receiveLoopCancellation;
        Action<LanDatagram> _onDatagram;

        public bool IsOpen => _client != null;

        public void Open(int port)
        {
            Close();

            var client = new UdpClient(port);
            client.EnableBroadcast = true;
            _client = client;
        }

        public void StartReceiving(Action<LanDatagram> onDatagram)
        {
            if (onDatagram == null) throw new ArgumentNullException(nameof(onDatagram));
            if (_client == null) throw new InvalidOperationException("StartReceiving called before Open succeeded.");

            _onDatagram = onDatagram;
            _receiveLoopCancellation?.Cancel();
            var cts = new CancellationTokenSource();
            _receiveLoopCancellation = cts;

            // Fire-and-forget by design: this loop's lifetime is owned by
            // _receiveLoopCancellation, not by anything awaiting this call. StartReceiving
            // itself returns immediately, matching IHeadsetQrScanner.StartScanning's own
            // "begins, does not block" contract.
            _ = ReceiveLoopAsync(_client, cts.Token);
        }

        public void StopReceiving()
        {
            _receiveLoopCancellation?.Cancel();
            _receiveLoopCancellation = null;
            _onDatagram = null;
        }

        public void Send(byte[] payload, string address, int port)
        {
            UdpClient client = _client;
            if (client == null) return; // closed — a caller racing Close() gets a silent no-op, matching LanDiscoverySocket.send

            IPAddress parsed;
            if (!IPAddress.TryParse(address, out parsed)) return; // malformed address supplied by a caller — refuse, never throw here
            client.Send(payload, payload.Length, new IPEndPoint(parsed, port));
        }

        public void Close()
        {
            _receiveLoopCancellation?.Cancel();
            _receiveLoopCancellation = null;
            _onDatagram = null;

            _client?.Close();
            _client = null;

            _recentDigests.Clear();
        }

        async Task ReceiveLoopAsync(UdpClient client, CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                UdpReceiveResult result;
                try
                {
                    result = await client.ReceiveAsync().ConfigureAwait(false);
                }
                catch (ObjectDisposedException)
                {
                    return; // Close() ran — the socket underneath this loop is gone; stop quietly.
                }
                catch (SocketException)
                {
                    // A transport-level receive failure (e.g. an ICMP port-unreachable from a
                    // prior send bouncing back). Not fatal to the loop — a hostile or merely
                    // noisy local network can produce these continuously, and one failed read
                    // says nothing about the next one.
                    continue;
                }

                if (token.IsCancellationRequested) return;
                HandleDatagram(result);
            }
        }

        void HandleDatagram(UdpReceiveResult result)
        {
            byte[] data = result.Buffer;

            // Hostile-network guard, first: refuse anything too large to plausibly be a
            // genuine message before spending any more work on it.
            if (data.Length > _maxDatagramBytes) return;

            string senderAddress = result.RemoteEndPoint.Address.ToString();
            int senderPort = result.RemoteEndPoint.Port;

            PruneDedup();
            string key = DedupKey(senderAddress, senderPort, data);
            if (_recentDigests.ContainsKey(key)) return; // exact duplicate from the same sender, within the window
            _recentDigests[key] = DateTime.UtcNow;

            _onDatagram?.Invoke(new LanDatagram(data, senderAddress, senderPort));
        }

        void PruneDedup()
        {
            DateTime cutoff = DateTime.UtcNow - _dedupWindow;
            var stale = new List<string>();
            foreach (KeyValuePair<string, DateTime> entry in _recentDigests)
            {
                if (entry.Value < cutoff) stale.Add(entry.Key);
            }
            foreach (string key in stale) _recentDigests.Remove(key);
        }

        static string DedupKey(string senderAddress, int senderPort, byte[] data)
        {
            // Sender address and port, plus a fast rolling hash of the payload — mirrors
            // LanDiscoverySocket's own _dedupKey exactly; see that class's doc for why sender
            // identity is always part of the key, and why this need not be collision-resistant.
            int hash = 17;
            foreach (byte b in data) hash = unchecked((hash * 31 + b) & 0x7fffffff);
            return senderAddress + ":" + senderPort + ":" + hash;
        }
    }
}
