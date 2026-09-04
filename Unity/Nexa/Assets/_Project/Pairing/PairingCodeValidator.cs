using System.Text.RegularExpressions;

namespace Nexa.Pairing
{
    /// <summary>Why a scanned string was refused as an NX2 pairing code.</summary>
    public enum PairingCodeRejectionReason
    {
        /// The string was null, empty, or whitespace only.
        Empty,

        /// Longer than any real pairing code could ever legitimately be — refused before any
        /// other check even runs, so a large or crafted input costs this method as little as
        /// possible to reject.
        TooLong,

        /// Does not begin with the literal <c>NX2.</c> prefix.
        WrongPrefix,

        /// The text after the prefix is not exactly the length a real secret is.
        WrongSecretLength,

        /// The text after the prefix contains a character outside base64url.
        InvalidSecretCharacters,
    }

    /// <summary>The result of validating one candidate string against the NX2 pairing-code shape.</summary>
    public readonly struct PairingCodeValidation
    {
        PairingCodeValidation(bool isValid, string code, PairingCodeRejectionReason? reason)
        {
            IsValid = isValid;
            Code = code;
            Reason = reason;
        }

        public static PairingCodeValidation Valid(string code) => new PairingCodeValidation(true, code, null);

        public static PairingCodeValidation Invalid(PairingCodeRejectionReason reason) =>
            new PairingCodeValidation(false, null, reason);

        public bool IsValid { get; }

        /// <summary>The validated code, unchanged from the input, exactly as received — meaningful
        /// only when <see cref="IsValid"/>. This method never transforms, trims, or re-derives
        /// what it validates; it only decides whether to pass the original string through.</summary>
        public string Code { get; }

        /// <summary>Meaningful only when <see cref="IsValid"/> is <c>false</c>.</summary>
        public PairingCodeRejectionReason? Reason { get; }

        /// <summary>Deliberately never includes <see cref="Code"/> — see its own doc.</summary>
        public override string ToString() =>
            IsValid
                ? "PairingCodeValidation(valid: true)"
                : $"PairingCodeValidation(valid: false, reason: {Reason})";
    }

    /// <summary>
    /// Decides whether a string a scanner reported is a genuine NX2 pairing code — the one
    /// checkpoint every scanned payload passes through before anything in this app trusts it
    /// with running <c>IHeadsetIdentity.Sign</c> or being handed to a later pairing stage.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A QR symbol's decoded text is untrusted input by construction — <c>IHeadsetQrScanner</c>
    /// will happily decode a URL, a JSON blob, a copy-pasted access token, or arbitrary noise,
    /// because a QR scanner's job is reading symbols, not judging their content. This class is
    /// where that judgement actually happens, once, in one place, rather than left to whatever
    /// eventually consumes a scan result.
    /// </para>
    /// <para>
    /// This class does not generate codes, does not know how the backend derives one, and does
    /// not duplicate <c>randomSecret()</c>'s own logic (see
    /// <c>apps/backend/src/devices/secrets.ts</c>) — it only recognises the *shape* that
    /// function is documented to produce: the literal prefix <c>NX2.</c>, followed by exactly
    /// what 256 bits of CSPRNG output encodes to as unpadded base64url — 43 characters from
    /// <c>A-Z a-z 0-9 - _</c>. A code from a differently-shaped future backend would need this
    /// validator updated deliberately; that is the point, not a gap.
    /// </para>
    /// <para>
    /// Every check here is a rejection, never a repair: a malformed prefix, an unexpected
    /// delimiter, a wrong length, or a character outside the expected alphabet all refuse the
    /// input outright rather than trying to salvage something plausible-looking from it. A
    /// pairing code is either exactly this shape or it is not a pairing code.
    /// </para>
    /// </remarks>
    public static class PairingCodeValidator
    {
        /// <summary>The one fixed prefix a real pairing code ever has.</summary>
        public const string Prefix = "NX2.";

        /// <summary>
        /// The exact length of the secret portion: 256 bits (32 bytes), base64url-encoded with
        /// no padding — <c>ceil(32 * 8 / 6) = 43</c> characters. Matches
        /// <c>apps/backend/src/devices/secrets.ts</c>'s <c>randomSecret()</c> exactly.
        /// </summary>
        public const int SecretLength = 43;

        /// <summary>
        /// A generous ceiling checked before any other work — comfortably above
        /// <see cref="Prefix"/>.Length + <see cref="SecretLength"/> (47), but small enough that
        /// nothing resembling a real code could ever need more. Refuses a JSON blob, a JWT, or
        /// simply a very long crafted string in one cheap comparison, before this method spends
        /// any time on character-by-character validation.
        /// </summary>
        public const int MaxLength = 128;

        static readonly Regex SecretPattern = new Regex("^[A-Za-z0-9_-]+$", RegexOptions.Compiled);

        public static PairingCodeValidation Validate(string candidate)
        {
            if (string.IsNullOrEmpty(candidate))
                return PairingCodeValidation.Invalid(PairingCodeRejectionReason.Empty);

            if (candidate.Length > MaxLength)
                return PairingCodeValidation.Invalid(PairingCodeRejectionReason.TooLong);

            if (!candidate.StartsWith(Prefix, System.StringComparison.Ordinal))
                return PairingCodeValidation.Invalid(PairingCodeRejectionReason.WrongPrefix);

            string secret = candidate.Substring(Prefix.Length);

            if (secret.Length != SecretLength)
                return PairingCodeValidation.Invalid(PairingCodeRejectionReason.WrongSecretLength);

            if (!SecretPattern.IsMatch(secret))
                return PairingCodeValidation.Invalid(PairingCodeRejectionReason.InvalidSecretCharacters);

            return PairingCodeValidation.Valid(candidate);
        }
    }
}
