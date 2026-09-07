using System;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    [TestFixture]
    public class HeadsetAdvertisementCodecTests
    {
        static HeadsetAdvertisement Advert(
            string deviceName = "Meta Quest 3",
            string enrolmentHandle = "the-secret-enrolment-handle",
            DateTime? issuedAtUtc = null) =>
            new HeadsetAdvertisement(deviceName, enrolmentHandle, issuedAtUtc ?? DateTime.UtcNow);

        [Test]
        public void RoundTripsThroughEncodeThenTryDecode()
        {
            HeadsetAdvertisement original = Advert();

            string raw = HeadsetAdvertisementCodec.Encode(original);
            bool ok = HeadsetAdvertisementCodec.TryDecode(raw, out HeadsetAdvertisement decoded);

            Assert.IsTrue(ok);
            Assert.AreEqual(original.DeviceName, decoded.DeviceName);
            Assert.AreEqual(original.EnrolmentHandle, decoded.EnrolmentHandle);
            // Round-tripped through a string ("o" format) — compare to the second, not the tick.
            Assert.AreEqual(original.IssuedAtUtc.ToString("o"), decoded.IssuedAtUtc.ToString("o"));
        }

        [Test]
        public void TryDecodeFailsForAStringThatIsNotJsonAtAll()
        {
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode("not json", out _));
        }

        [Test]
        public void TryDecodeFailsForAnEmptyString()
        {
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode("", out _));
        }

        [Test]
        public void TryDecodeFailsForWellFormedJsonWithTheWrongMagic()
        {
            const string raw = "{\"magic\":\"some-other-protocol-v1\",\"type\":\"advertisement\"," +
                                "\"deviceName\":\"x\",\"enrolmentHandle\":\"x\",\"issuedAt\":\"2026-01-01T00:00:00.000Z\"}";
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode(raw, out _));
        }

        [Test]
        public void TryDecodeFailsForAnUnrecognizedType()
        {
            const string raw = "{\"magic\":\"nexa.pairing.v1\",\"type\":\"self_destruct\"," +
                                "\"deviceName\":\"x\",\"enrolmentHandle\":\"x\",\"issuedAt\":\"2026-01-01T00:00:00.000Z\"}";
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode(raw, out _));
        }

        [Test]
        public void TryDecodeFailsForAMissingEnrolmentHandle()
        {
            const string raw = "{\"magic\":\"nexa.pairing.v1\",\"type\":\"advertisement\"," +
                                "\"deviceName\":\"x\",\"issuedAt\":\"2026-01-01T00:00:00.000Z\"}";
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode(raw, out _));
        }

        [Test]
        public void TryDecodeFailsForAnOversizedPayload()
        {
            string huge = new string('x', PairingLanEnvelope.MaxEncodedChars + 1);
            Assert.IsFalse(HeadsetAdvertisementCodec.TryDecode(huge, out _));
        }

        [Test]
        public void EncodeProducesAnExplicitAdvertisementTypeField()
        {
            string raw = HeadsetAdvertisementCodec.Encode(Advert());
            StringAssert.Contains("\"type\":\"advertisement\"", raw);
            StringAssert.Contains("\"magic\":\"nexa.pairing.v1\"", raw);
        }

        [Test]
        public void AdvertisementToStringNeverIncludesTheEnrolmentHandle()
        {
            HeadsetAdvertisement advert = Advert(enrolmentHandle: "super-secret-handle");
            StringAssert.DoesNotContain("super-secret-handle", advert.ToString());
        }
    }
}
