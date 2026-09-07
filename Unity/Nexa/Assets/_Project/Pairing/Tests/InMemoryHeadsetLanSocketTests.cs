using System.Text;
using Nexa.Core.Pairing;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    [TestFixture]
    public class InMemoryHeadsetLanSocketTests
    {
        [Test]
        public void OpenMakesIsOpenTrue()
        {
            var socket = new InMemoryHeadsetLanSocket();
            Assert.IsFalse(socket.IsOpen);

            socket.Open(47332);

            Assert.IsTrue(socket.IsOpen);
        }

        [Test]
        public void CloseMakesIsOpenFalseAndStopsDelivery()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);

            bool received = false;
            socket.StartReceiving(_ => received = true);
            socket.Close();

            socket.EmitDatagram(new LanDatagram(Encoding.UTF8.GetBytes("x"), "127.0.0.1", 1));

            Assert.IsFalse(socket.IsOpen);
            Assert.IsFalse(received);
        }

        [Test]
        public void EmitDatagramDeliversToTheStartReceivingCallback()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);

            LanDatagram? seen = null;
            socket.StartReceiving(d => seen = d);

            var payload = Encoding.UTF8.GetBytes("hello");
            socket.EmitDatagram(new LanDatagram(payload, "192.168.1.5", 9000));

            Assert.IsTrue(seen.HasValue);
            Assert.AreEqual(payload, seen.Value.Payload);
            Assert.AreEqual("192.168.1.5", seen.Value.SenderAddress);
            Assert.AreEqual(9000, seen.Value.SenderPort);
        }

        [Test]
        public void StopReceivingPreventsFurtherDelivery()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);

            bool received = false;
            socket.StartReceiving(_ => received = true);
            socket.StopReceiving();

            socket.EmitDatagram(new LanDatagram(Encoding.UTF8.GetBytes("x"), "127.0.0.1", 1));

            Assert.IsFalse(received);
        }

        [Test]
        public void SendRecordsWhatWasSentAndWhere()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);

            var payload = Encoding.UTF8.GetBytes("payload");
            socket.Send(payload, "10.0.0.2", 47332);

            Assert.AreEqual(1, socket.Sent.Count);
            InMemoryHeadsetLanSocket.SentDatagram sent = socket.Sent[0];
            Assert.AreEqual(payload, sent.Payload);
            Assert.AreEqual("10.0.0.2", sent.Address);
            Assert.AreEqual(47332, sent.Port);
        }

        [Test]
        public void ReopeningClearsPriorReceivingState()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);
            bool received = false;
            socket.StartReceiving(_ => received = true);

            socket.Open(47332); // reconnect

            socket.EmitDatagram(new LanDatagram(Encoding.UTF8.GetBytes("x"), "127.0.0.1", 1));

            Assert.IsFalse(received, "a fresh Open() must not leave the previous StartReceiving callback wired up");
        }

        [Test]
        public void ForceEmitDatagramTolerantOfBeingCalledAfterStop()
        {
            var socket = new InMemoryHeadsetLanSocket();
            socket.Open(47332);
            bool received = false;
            socket.StartReceiving(_ => received = true);
            socket.StopReceiving();

            // Must not throw, even though nothing is listening any more.
            Assert.DoesNotThrow(() =>
                socket.ForceEmitDatagram(new LanDatagram(Encoding.UTF8.GetBytes("x"), "127.0.0.1", 1)));
            Assert.IsFalse(received);
        }
    }
}
