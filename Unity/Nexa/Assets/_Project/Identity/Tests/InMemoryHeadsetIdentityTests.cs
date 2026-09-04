using System;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Nexa.Core.Identity;
using NUnit.Framework;

namespace Nexa.Identity.Tests
{
    /// <summary>
    /// Exercises <see cref="IHeadsetIdentity"/>'s contract against
    /// <see cref="InMemoryHeadsetIdentity"/> — the same platform-neutral surface
    /// <see cref="AndroidHeadsetIdentity"/> implements, with real P-256 cryptography underneath
    /// and no platform dependency. See that class's own doc for what it can and cannot stand in
    /// for.
    /// </summary>
    [TestFixture]
    public sealed class InMemoryHeadsetIdentityTests
    {
        static byte[] Challenge(string text) => Encoding.UTF8.GetBytes(text);

        [Test]
        public void HasKey_is_false_before_EnsureKey_and_true_after()
        {
            var identity = new InMemoryHeadsetIdentity();
            Assert.IsFalse(identity.HasKey);

            identity.EnsureKey();

            Assert.IsTrue(identity.HasKey);
        }

        [Test]
        public void repeated_EnsureKey_calls_return_the_same_public_identity()
        {
            var identity = new InMemoryHeadsetIdentity();

            identity.EnsureKey();
            string firstId = identity.PublicKeyId;
            byte[] firstSpki = identity.PublicKeySpkiDer;

            identity.EnsureKey(); // must be a no-op, not a fresh key
            identity.EnsureKey();

            Assert.AreEqual(firstId, identity.PublicKeyId);
            CollectionAssert.AreEqual(firstSpki, identity.PublicKeySpkiDer);
        }

        [Test]
        public void two_separate_identities_never_collide()
        {
            var a = new InMemoryHeadsetIdentity();
            var b = new InMemoryHeadsetIdentity();
            a.EnsureKey();
            b.EnsureKey();

            Assert.AreNotEqual(a.PublicKeyId, b.PublicKeyId);
        }

        [Test]
        public void PublicKeyId_is_the_expected_shape_base64url_43_characters_unpadded()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            string id = identity.PublicKeyId;

            Assert.AreEqual(43, id.Length, "base64url(SHA-256(...)) with no padding is always 43 characters");
            Assert.IsFalse(id.Contains("+"), "base64url must never contain '+'");
            Assert.IsFalse(id.Contains("/"), "base64url must never contain '/'");
            Assert.IsFalse(id.Contains("="), "unpadded base64url must never contain '='");
        }

        [Test]
        public void PublicKeyId_matches_hashing_the_returned_SPKI_independently()
        {
            // Locks in that PublicKeyId is genuinely derived FROM PublicKeySpkiDer, the same
            // relationship apps/backend/src/devices/spki.ts's parseP256Spki has between its
            // `der` and its `keyId` — never two independently-computed values that merely
            // happen to agree today.
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            byte[] spki = identity.PublicKeySpkiDer;
            string expected;
            using (SHA256 sha256 = SHA256.Create())
            {
                expected = Convert.ToBase64String(sha256.ComputeHash(spki))
                    .Replace('+', '-').Replace('/', '_').TrimEnd('=');
            }

            Assert.AreEqual(expected, identity.PublicKeyId);
        }

        [Test]
        public void Sign_produces_a_DER_signature_that_verifies_against_the_public_key()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();
            byte[] challenge = Challenge("a real pairing challenge, exactly as built server-side");

            byte[] derSignature = identity.Sign(challenge);

            // Shape: a DER SEQUENCE, as verifyChallenge (dsaEncoding: 'der') expects.
            Assert.AreEqual(0x30, derSignature[0]);

            // Substance: the signature genuinely verifies against this identity's own public key
            // — proving Sign is real cryptography, not a shape-only stand-in. Verified with
            // P256Curve.VerifyData rather than System.Security.Cryptography.ECDsa: ECDsa is not
            // implemented under Mono (see P256Curve's own class doc) and would throw here exactly
            // as it does inside InMemoryHeadsetIdentity itself — this is an independent
            // implementation of the same standard verification equation, not a weaker check.
            EcdsaDerSignature.Decode(derSignature, out byte[] r, out byte[] s);
            byte[] rawP1363 = r.Concat(s).ToArray();

            byte[] x, y;
            ExtractXy(identity.PublicKeySpkiDer, out x, out y);
            Assert.IsTrue(P256Curve.VerifyData(challenge, rawP1363, x, y));
        }

        [Test]
        public void Sign_over_a_different_challenge_produces_a_signature_that_does_not_verify_against_the_first()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            byte[] signatureA = identity.Sign(Challenge("challenge A"));
            EcdsaDerSignature.Decode(signatureA, out byte[] r, out byte[] s);
            byte[] rawA = r.Concat(s).ToArray();

            byte[] x, y;
            ExtractXy(identity.PublicKeySpkiDer, out x, out y);
            Assert.IsFalse(P256Curve.VerifyData(Challenge("challenge B — not what was signed"), rawA, x, y));
        }

        [Test]
        public void Sign_rejects_null()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();

            Assert.Throws<ArgumentNullException>(() => identity.Sign(null));
        }

        [Test]
        public void operations_before_EnsureKey_fail_explicitly_rather_than_silently_generating_a_key()
        {
            var identity = new InMemoryHeadsetIdentity();

            Assert.Throws<HeadsetIdentityException>(() => { var _ = identity.PublicKeySpkiDer; });
            Assert.Throws<HeadsetIdentityException>(() => { var _ = identity.PublicKeyId; });
            Assert.Throws<HeadsetIdentityException>(() => identity.Sign(Challenge("x")));

            // The failure must not have had the side effect it explicitly must never have.
            Assert.IsFalse(identity.HasKey);
        }

        [Test]
        public void DeleteKey_removes_the_key_and_subsequent_operations_fail_explicitly_again()
        {
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();
            Assert.IsTrue(identity.HasKey);

            identity.DeleteKey();

            Assert.IsFalse(identity.HasKey);
            Assert.Throws<HeadsetIdentityException>(() => identity.Sign(Challenge("x")));
        }

        [Test]
        public void DeleteKey_is_never_called_by_any_other_member()
        {
            // A weaker guarantee than reading the source, but a real one: drive every operation
            // that can legitimately run without EnsureKey ever having failed, across many calls,
            // and confirm the key that survives at the end is still the one first generated —
            // nothing along the way silently deleted and replaced it.
            var identity = new InMemoryHeadsetIdentity();
            identity.EnsureKey();
            string originalId = identity.PublicKeyId;

            for (int i = 0; i < 5; i++)
            {
                identity.EnsureKey();
                _ = identity.PublicKeySpkiDer;
                _ = identity.PublicKeyId;
                _ = identity.Sign(Challenge($"turn {i}"));
                _ = identity.SecurityLevel;
            }

            Assert.AreEqual(originalId, identity.PublicKeyId);
        }

        [Test]
        public void SecurityLevel_is_Unknown_before_a_key_exists_and_Software_after()
        {
            var identity = new InMemoryHeadsetIdentity();
            Assert.AreEqual(KeySecurityLevel.Unknown, identity.SecurityLevel);

            identity.EnsureKey();

            Assert.AreEqual(KeySecurityLevel.Software, identity.SecurityLevel,
                "an in-memory identity must never claim hardware backing it does not have");
        }

        [Test]
        public void IHeadsetIdentity_exposes_no_member_that_could_return_private_key_material()
        {
            // A defensive, API-shape assertion rather than a behavioural one: this fails the
            // moment anyone — in this class or a future implementation — adds a member whose
            // name suggests it hands back private key bytes, before it ships anywhere.
            string[] forbidden = { "private", "secret" };

            foreach (MemberInfo member in typeof(IHeadsetIdentity).GetMembers())
            {
                string lowerName = member.Name.ToLowerInvariant();
                foreach (string word in forbidden)
                {
                    Assert.IsFalse(lowerName.Contains(word),
                        $"IHeadsetIdentity.{member.Name} suggests private key exposure and must not exist");
                }
            }
        }

        static void ExtractXy(byte[] spkiDer, out byte[] x, out byte[] y)
        {
            // The fixed 27-byte prefix EcP256SpkiDer.Encode always writes, then 32+32 raw bytes —
            // the exact inverse of that class's own construction, used here only to get back to
            // an ECParameters this test can hand to a real verifier.
            Assert.AreEqual(91, spkiDer.Length);
            x = new byte[32];
            y = new byte[32];
            Array.Copy(spkiDer, 27, x, 0, 32);
            Array.Copy(spkiDer, 27 + 32, y, 0, 32);
        }
    }
}
