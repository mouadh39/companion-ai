using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    [TestFixture]
    public class PairingLanEnvelopeTests
    {
        [Test]
        public void EmptyStringIsNotAPlausibleSize()
        {
            Assert.IsFalse(PairingLanEnvelope.IsPlausibleSize(""));
        }

        [Test]
        public void NullIsNotAPlausibleSize()
        {
            Assert.IsFalse(PairingLanEnvelope.IsPlausibleSize(null));
        }

        [Test]
        public void AnOrdinaryShortMessageIsPlausible()
        {
            Assert.IsTrue(PairingLanEnvelope.IsPlausibleSize("{\"magic\":\"nexa.pairing.v1\"}"));
        }

        [Test]
        public void ExactlyAtTheLimitIsStillPlausible()
        {
            string raw = new string('x', PairingLanEnvelope.MaxEncodedChars);
            Assert.IsTrue(PairingLanEnvelope.IsPlausibleSize(raw));
        }

        [Test]
        public void OneOverTheLimitIsNotPlausible()
        {
            string raw = new string('x', PairingLanEnvelope.MaxEncodedChars + 1);
            Assert.IsFalse(PairingLanEnvelope.IsPlausibleSize(raw));
        }

        [Test]
        public void AdvertisementIsARecognizedType()
        {
            Assert.IsTrue(PairingLanEnvelope.IsRecognizedType("advertisement"));
        }

        [Test]
        public void AnEmptyOrNullTypeDefaultsToRecognizedForBackwardCompatibility()
        {
            Assert.IsTrue(PairingLanEnvelope.IsRecognizedType(""));
            Assert.IsTrue(PairingLanEnvelope.IsRecognizedType(null));
        }

        [Test]
        public void AnUnknownTypeIsNotRecognized()
        {
            Assert.IsFalse(PairingLanEnvelope.IsRecognizedType("self_destruct"));
        }
    }
}
