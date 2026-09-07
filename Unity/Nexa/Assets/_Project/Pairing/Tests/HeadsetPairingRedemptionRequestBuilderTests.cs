using System;
using System.Security.Cryptography;
using Nexa.Core.Identity;
using Nexa.Identity;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    /// <summary>
    /// Exercises <see cref="HeadsetPairingRedemptionRequestBuilder"/> against
    /// <see cref="InMemoryHeadsetIdentity"/> — real P-256 signing, no platform dependency — the
    /// same combination <c>Nexa.Identity.Tests</c> already trusts for real-cryptography coverage.
    /// </summary>
    [TestFixture]
    public class HeadsetPairingRedemptionRequestBuilderTests
    {
        const string ValidCode = "NX2.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";
        const string PairingSessionId = "pairing-session-001";

        [Test]
        public void BuildProducesARequestCarryingTheExactCodeAndAVerifiableSignature()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            PairingRedemptionRequest request =
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, ValidCode);

            Assert.AreEqual(ValidCode, request.Code);
            Assert.IsNotNull(request.SignatureDer);
            Assert.AreEqual(0x30, request.SignatureDer[0], "must be a DER SEQUENCE, as verifyChallenge expects");

            // Substance, not just shape: the signature genuinely verifies against this identity's
            // own public key, over the exact challenge PairingChallenge.Build would produce for
            // this (pairingSessionId, secret, headsetPublicKeyId) triple — the same "prove it's
            // real cryptography" standard Nexa.Identity.Tests already holds Sign() to.
            byte[] expectedChallenge = PairingChallenge.Build(
                PairingSessionId, ValidCode.Substring(PairingCodeValidator.Prefix.Length), identity.PublicKeyId);

            Assert.IsTrue(VerifiesAgainst(identity.PublicKeySpkiDer, expectedChallenge, request.SignatureDer));
        }

        [Test]
        public void ASignatureFromADifferentIdentityNeverVerifiesAgainstThisOnesKey()
        {
            // The "wrong private key = FAILURE" case: a redemption request built by an impostor
            // holding a different key must not verify against the genuine headset's public key —
            // exactly what the backend's own verifyChallenge relies on to refuse it.
            var genuine = new InMemoryHeadsetIdentity();
            genuine.EnsureKey();
            var impostor = new InMemoryHeadsetIdentity();
            impostor.EnsureKey();

            // The impostor signs a request as if it already knew the genuine headset's own
            // PublicKeyId — the most favourable case for the impostor, since in reality it
            // would only ever know its own. Even then, the private key differs, so the signature
            // cannot verify against the genuine public key.
            byte[] challenge = PairingChallenge.Build(
                PairingSessionId, ValidCode.Substring(PairingCodeValidator.Prefix.Length), genuine.PublicKeyId);
            byte[] impostorSignature = impostor.Sign(challenge);

            Assert.IsFalse(VerifiesAgainst(genuine.PublicKeySpkiDer, challenge, impostorSignature));
        }

        [Test]
        public void NullIdentityThrows()
        {
            Assert.Throws<ArgumentNullException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(null, PairingSessionId, ValidCode));
        }

        [Test]
        public void EmptyPairingSessionIdThrows()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            Assert.Throws<ArgumentException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(identity, "", ValidCode));
        }

        [Test]
        public void NullPairingSessionIdThrows()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            Assert.Throws<ArgumentException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(identity, null, ValidCode));
        }

        [Test]
        public void CodeWithoutTheNx2PrefixThrows()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            Assert.Throws<ArgumentException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, "not-a-real-code"));
        }

        [Test]
        public void EmptyCodeThrows()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            Assert.Throws<ArgumentException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, ""));
        }

        [Test]
        public void SigningWithNoKeyEverGeneratedPropagatesHeadsetIdentityException()
        {
            // EnsureKey() is deliberately never called — Build() must not silently generate one
            // on the caller's behalf, or swallow the failure; it lets IHeadsetIdentity's own
            // exception propagate exactly as Sign() itself raises it.
            var identity = new InMemoryHeadsetIdentity();

            Assert.Throws<HeadsetIdentityException>(() =>
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, ValidCode));
        }

        [Test]
        public void RedemptionRequestToStringNeverIncludesTheCodeOrSignatureBytes()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            PairingRedemptionRequest request =
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, ValidCode);

            string text = request.ToString();
            StringAssert.DoesNotContain(ValidCode, text);
            StringAssert.DoesNotContain(request.SignatureBase64, text);
        }

        [Test]
        public void SignatureBase64RoundTripsToTheSameBytesAsSignatureDer()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            PairingRedemptionRequest request =
                HeadsetPairingRedemptionRequestBuilder.Build(identity, PairingSessionId, ValidCode);

            CollectionAssert.AreEqual(request.SignatureDer, Convert.FromBase64String(request.SignatureBase64));
        }

        static bool VerifiesAgainst(byte[] spkiDer, byte[] challenge, byte[] derSignature)
        {
            EcdsaDerSignature.Decode(derSignature, out byte[] r, out byte[] s);
            byte[] rawP1363 = new byte[64];
            Buffer.BlockCopy(r, 0, rawP1363, 0, 32);
            Buffer.BlockCopy(s, 0, rawP1363, 32, 32);

            byte[] x, y;
            ExtractXy(spkiDer, out x, out y);
            var parameters = new ECParameters
            {
                Curve = ECCurve.NamedCurves.nistP256,
                Q = new ECPoint { X = x, Y = y },
            };
            using (ECDsa verifier = ECDsa.Create(parameters))
            {
                return verifier.VerifyData(challenge, rawP1363, HashAlgorithmName.SHA256);
            }
        }

        static void ExtractXy(byte[] spkiDer, out byte[] x, out byte[] y)
        {
            // Same fixed 27-byte SPKI prefix EcP256SpkiDer.Encode always writes — see
            // Nexa.Identity.Tests.InMemoryHeadsetIdentityTests for the identical helper this
            // mirrors.
            Assert.AreEqual(91, spkiDer.Length);
            x = new byte[32];
            y = new byte[32];
            Array.Copy(spkiDer, 27, x, 0, 32);
            Array.Copy(spkiDer, 27 + 32, y, 0, 32);
        }
    }
}
