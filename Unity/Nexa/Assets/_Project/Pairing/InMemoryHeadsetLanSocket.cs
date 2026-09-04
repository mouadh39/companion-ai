using System;
using System.Collections.Generic;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// A deterministic, in-memory <see cref="IHeadsetLanSocket"/> for tests — no real socket, no
    /// platform dependency, no timing. The C#/Unity counterpart to what
    /// <c>LanDiscoverySocket_test.dart</c> exercises against a real bound UDP socket on
    /// loopback; this class exists because Unity code cannot be compiled or run at all in this
    /// environment (see the report), so there is no way to prove a real socket implementation
    /// works here even on loopback — this fake is what every test in <c>Nexa.Pairing.Tests</c>
    /// exercises instead, the same relationship <c>InMemoryHeadsetQrScanner</c> already has to a
    /// real camera.
    /// </summary>
    public sealed class InMemoryHeadsetLanSocket : IHeadsetLanSocket
    {
        Action<LanDatagram> _onDatagram;

        public bool IsOpen { get; private set; }

        /// <summary>One recorded call to <see cref="Send"/> — see <see cref="Sent"/>.</summary>
        public readonly struct SentDatagram
        {
            public SentDatagram(byte[] payload, string address, int port)
            {
                Payload = payload;
                Address = address;
                Port = port;
            }

            public byte[] Payload { get; }
            public string Address { get; }
            public int Port { get; }
        }

        /// <summary>Every payload <see cref="Send"/> was called with, in order — what a test checks to confirm a caller sent the right bytes to the right place.</summary>
        public List<SentDatagram> Sent { get; } = new List<SentDatagram>();

        public void Open(int port)
        {
            Close();
            IsOpen = true;
        }

        public void Close()
        {
            IsOpen = false;
            _onDatagram = null;
        }

        public void StartReceiving(Action<LanDatagram> onDatagram)
        {
            _onDatagram = onDatagram ?? throw new ArgumentNullException(nameof(onDatagram));
        }

        public void StopReceiving() => _onDatagram = null;

        public void Send(byte[] payload, string address, int port)
        {
            Sent.Add(new SentDatagram(payload, address, port));
        }

        /// <summary>
        /// Delivers one datagram to whatever callback <see cref="StartReceiving"/> was given, as
        /// if it had just arrived over a real socket. Does nothing if not currently receiving —
        /// the same "cannot deliver after being stopped" contract a real socket has.
        /// </summary>
        public void EmitDatagram(LanDatagram datagram)
        {
            if (!IsOpen) return;
            _onDatagram?.Invoke(datagram);
        }

        /// <summary>
        /// Delivers a datagram even if receiving has already stopped — exists only to test that a
        /// consumer tolerates a stray late callback, the same reason
        /// <c>InMemoryHeadsetQrScanner.ForceEmitFrame</c> exists.
        /// </summary>
        public void ForceEmitDatagram(LanDatagram datagram) => _onDatagram?.Invoke(datagram);
    }
}
