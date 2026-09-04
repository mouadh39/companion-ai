using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    /// <summary>
    /// Covers items 1–9 of Step 3F-H's required test list: everything about whether a scanned
    /// string is recognised as a genuine NX2 pairing code, independent of any scanner or camera.
    /// </summary>
    [TestFixture]
    public class PairingCodeValidatorTests
    {
        // A syntactically valid NX2 code: the literal prefix, followed by exactly 43 base64url
        // characters — the shape apps/backend/src/devices/secrets.ts's randomSecret() produces.
        // Not a real backend-issued secret; this file never talks to the backend.
        const string ValidSecret = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ABCDE";
        const string ValidCode = "NX2." + ValidSecret;

        [Test]
        public void ValidNx2CodeIsAccepted()
        {
            var result = PairingCodeValidator.Validate(ValidCode);

            Assert.IsTrue(result.IsValid);
            Assert.IsNull(result.Reason);
        }

        [Test]
        public void ExactPayloadIsPreservedUnchanged()
        {
            var result = PairingCodeValidator.Validate(ValidCode);

            // Not just "looks similar" — the exact same string instance's content, unmodified,
            // untrimmed, un-re-encoded. See the validator's own doc: it is a gate, not a parser
            // that reconstructs its output from parts.
            Assert.AreEqual(ValidCode, result.Code);
        }

        [Test]
        public void MalformedPrefixIsRejected()
        {
            // One character off from the real prefix — must not be treated as "close enough."
            var result = PairingCodeValidator.Validate("NX1." + ValidSecret);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void CaseSensitivePrefixIsRejected()
        {
            // The backend's prefix is a literal, case-sensitive constant — "nx2." must not match.
            var result = PairingCodeValidator.Validate("nx2." + ValidSecret);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void EmptyPayloadIsRejected()
        {
            var result = PairingCodeValidator.Validate("");

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.Empty, result.Reason);
        }

        [Test]
        public void NullPayloadIsRejected()
        {
            var result = PairingCodeValidator.Validate(null);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.Empty, result.Reason);
        }

        [Test]
        public void UrlPayloadIsRejected()
        {
            // Exactly the kind of thing a real QR scanner will happily decode without complaint —
            // some other app's QR code, or a phishing attempt, pointed at this camera.
            var result = PairingCodeValidator.Validate("https://nexa.app/pair?code=abc123");

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void JsonPayloadIsRejected()
        {
            var result = PairingCodeValidator.Validate("{\"code\":\"NX2." + ValidSecret + "\"}");

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void AccessTokenLikePayloadIsRejected()
        {
            // Shaped like a JWT (three dot-separated base64url segments) — the access-token shape
            // this codebase's own backend issues elsewhere in the pairing flow. A QR that somehow
            // carried one must never be mistaken for a pairing code.
            var result = PairingCodeValidator.Validate(
                "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void RefreshTokenLikePayloadIsRejected()
        {
            // The bare secret alone, with no NX2. prefix — the same shape a refresh token's opaque
            // value has (see apps/backend/src/devices/secrets.ts: both are randomSecret() output).
            // Only the prefix tells the two apart; without it, this must be refused.
            var result = PairingCodeValidator.Validate(ValidSecret);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongPrefix, result.Reason);
        }

        [Test]
        public void OversizedPayloadIsRejected()
        {
            var hugePayload = "NX2." + new string('A', 500);

            var result = PairingCodeValidator.Validate(hugePayload);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.TooLong, result.Reason);
        }

        [Test]
        public void WrongSecretLengthIsRejected()
        {
            var result = PairingCodeValidator.Validate("NX2." + ValidSecret.Substring(0, 40));

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.WrongSecretLength, result.Reason);
        }

        [Test]
        public void InvalidSecretCharactersAreRejected()
        {
            // Same length as a real secret, but with a character (+) outside base64url's alphabet.
            string secretWithPlus = "+" + ValidSecret.Substring(1);

            var result = PairingCodeValidator.Validate("NX2." + secretWithPlus);

            Assert.IsFalse(result.IsValid);
            Assert.AreEqual(PairingCodeRejectionReason.InvalidSecretCharacters, result.Reason);
        }

        [Test]
        public void ValidationToStringNeverIncludesTheCode()
        {
            var valid = PairingCodeValidator.Validate(ValidCode);
            var invalid = PairingCodeValidator.Validate("not-a-code");

            StringAssert.DoesNotContain(ValidSecret, valid.ToString());
            StringAssert.DoesNotContain("not-a-code", invalid.ToString());
        }
    }
}
