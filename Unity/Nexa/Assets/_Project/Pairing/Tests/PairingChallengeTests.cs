using System.Text;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    /// <summary>
    /// Proves <see cref="PairingChallenge.Build"/> reproduces the real backend's
    /// <c>buildChallenge</c> byte for byte — see <see cref="PairingChallenge"/>'s own doc on how
    /// the expected vector below was captured directly from that function, not hand-derived.
    /// </summary>
    [TestFixture]
    public class PairingChallengeTests
    {
        [Test]
        public void MatchesTheKnownVectorCapturedFromTheRealBackendFunction()
        {
            byte[] digest = PairingChallenge.Build(
                pairingSessionId: "test-session-id-001",
                secret: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE",
                headsetPublicKeyId: "test-headset-public-key-id");

            // Captured by importing the real apps/backend/src/devices/challenge.ts buildChallenge
            // into a throwaway Vitest test and running it with these exact inputs — see
            // PairingChallenge's own class doc for the full provenance of this vector.
            Assert.AreEqual(
                "f4450af5f415c00a20a21daa130007b51eab34a34330efc6cfb13b92a4ec849b",
                ToHex(digest));
        }

        [Test]
        public void IsAlways32BytesLikeAnySha256Digest()
        {
            byte[] digest = PairingChallenge.Build("s", "secret", "keyid");

            Assert.AreEqual(32, digest.Length);
        }

        [Test]
        public void DifferentPairingSessionIdsProduceDifferentDigests()
        {
            byte[] a = PairingChallenge.Build("session-a", "same-secret", "same-key-id");
            byte[] b = PairingChallenge.Build("session-b", "same-secret", "same-key-id");

            CollectionAssert.AreNotEqual(a, b);
        }

        [Test]
        public void DifferentSecretsProduceDifferentDigests()
        {
            byte[] a = PairingChallenge.Build("same-session", "secret-a", "same-key-id");
            byte[] b = PairingChallenge.Build("same-session", "secret-b", "same-key-id");

            CollectionAssert.AreNotEqual(a, b);
        }

        [Test]
        public void DifferentHeadsetPublicKeyIdsProduceDifferentDigests()
        {
            byte[] a = PairingChallenge.Build("same-session", "same-secret", "key-a");
            byte[] b = PairingChallenge.Build("same-session", "same-secret", "key-b");

            CollectionAssert.AreNotEqual(a, b);
        }

        [Test]
        public void FieldBoundariesAreNotJustDelimiterJoinedStrings()
        {
            // Exactly the ambiguity the length-prefixed encoding exists to avoid — see
            // PairingChallenge's own doc: "ab"+"c" must not hash the same as "a"+"bc" once each
            // field's own length is baked into the digest.
            byte[] merged = PairingChallenge.Build("ab", "c", "keyid");
            byte[] splitDifferently = PairingChallenge.Build("a", "bc", "keyid");

            CollectionAssert.AreNotEqual(merged, splitDifferently);
        }

        static string ToHex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes)
                builder.Append(b.ToString("x2"));
            return builder.ToString();
        }
    }
}
