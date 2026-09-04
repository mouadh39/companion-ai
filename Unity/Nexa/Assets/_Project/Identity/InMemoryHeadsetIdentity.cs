using System;
using System.Security.Cryptography;
using Nexa.Core.Identity;

namespace Nexa.Identity
{
    /// <summary>
    /// A genuine, in-process P-256 identity — real key generation, real ECDSA signing — with no
    /// Android Keystore, no JNI, and no platform dependency of any kind.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Not a stub. It generates a real P-256 keypair and produces real signatures via
    /// <see cref="P256Curve"/> — see that class's own doc for why this uses from-scratch
    /// <see cref="System.Numerics.BigInteger"/> arithmetic rather than
    /// <see cref="System.Security.Cryptography.ECDsa"/>: the latter is not implemented under Mono,
    /// the runtime the Unity Editor itself uses, which is exactly why every test exercising this
    /// class failed the moment a real Unity Editor first ran them. <see cref="P256Curve"/>'s own
    /// algorithm was cross-verified against real ECDsa on a non-Mono CLR before ever being used
    /// here — see its class doc for exactly how.
    /// </para>
    /// <para>
    /// Both the SPKI DER shape (<see cref="EcP256SpkiDer"/>) and the ASN.1 DER signature shape
    /// (<see cref="EcdsaDerSignature"/>) this class produces are unchanged from before — this class
    /// still reshapes bare curve coordinates into exactly the wire forms
    /// <see cref="AndroidHeadsetIdentity"/> produces, so a test exercising this class is exercising
    /// the same shapes a real headset would send, not a simplified stand-in for them. What it
    /// cannot exercise is Keystore itself: non-exportability, hardware backing, and behaviour
    /// across app reinstalls are all properties of the platform, not of cryptography, and no
    /// software fake can honestly claim to reproduce them — see the report's own section on what
    /// still needs a real device.
    /// </para>
    /// <para>
    /// This is what the Editor, and every non-Android platform, uses in place of
    /// <see cref="AndroidHeadsetIdentity"/> — and what every test in
    /// <c>Nexa.Identity.Tests</c> is written against.
    /// </para>
    /// </remarks>
    public sealed class InMemoryHeadsetIdentity : IHeadsetIdentity
    {
        // The generated keypair, held as fixed-width 32-byte big-endian coordinates — the same
        // shape P256Curve's own public surface already deals in, so nothing here re-encodes
        // anything P256Curve did not already produce in its final form.
        byte[] _d;
        byte[] _x;
        byte[] _y;

        public bool HasKey => _d != null;

        public void EnsureKey()
        {
            if (_d != null)
                return; // already exists — see the interface doc on why this never regenerates.

            try
            {
                P256Curve.KeyPair keyPair = P256Curve.GenerateKeyPair();
                _d = keyPair.D;
                _x = keyPair.X;
                _y = keyPair.Y;
            }
            catch (Exception exception)
            {
                throw new HeadsetIdentityException("Failed to generate an in-memory P-256 key.", exception);
            }
        }

        public byte[] PublicKeySpkiDer
        {
            get
            {
                RequireKey();
                return EcP256SpkiDer.Encode(_x, _y);
            }
        }

        public string PublicKeyId
        {
            get
            {
                byte[] spki = PublicKeySpkiDer;
                using (SHA256 sha256 = SHA256.Create())
                {
                    return Base64UrlNoPad(sha256.ComputeHash(spki));
                }
            }
        }

        public byte[] Sign(byte[] challenge)
        {
            if (challenge == null)
                throw new ArgumentNullException(nameof(challenge));

            byte[] d = RequireKey();
            byte[] rawSignature;
            try
            {
                // P256Curve.SignData hashes challenge with SHA-256 itself and signs the digest —
                // the same "ECDSA over SHA-256, no framing of its own" contract
                // ECDsa.SignData(data, HashAlgorithmName.SHA256) always had, and
                // IHeadsetIdentity.Sign's own doc still requires. Still IEEE P1363 raw r‖s, 64
                // bytes for P-256 — the shape EcdsaDerSignature.Encode below has always expected.
                rawSignature = P256Curve.SignData(challenge, d);
            }
            catch (Exception exception)
            {
                throw new HeadsetIdentityException("In-memory signing failed.", exception);
            }

            byte[] r = new byte[32];
            byte[] s = new byte[32];
            Buffer.BlockCopy(rawSignature, 0, r, 0, 32);
            Buffer.BlockCopy(rawSignature, 32, s, 0, 32);
            return EcdsaDerSignature.Encode(r, s);
        }

        /// <summary>
        /// Always <see cref="Nexa.Core.Identity.KeySecurityLevel.Software"/> once a key exists —
        /// there is no hardware here to report anything else, and this class must never claim
        /// otherwise. <see cref="Nexa.Core.Identity.KeySecurityLevel.Unknown"/> before one does.
        /// </summary>
        public KeySecurityLevel SecurityLevel => _d != null ? KeySecurityLevel.Software : KeySecurityLevel.Unknown;

        public void DeleteKey()
        {
            _d = null;
            _x = null;
            _y = null;
        }

        byte[] RequireKey()
        {
            if (_d == null)
                throw new HeadsetIdentityException("No key exists — call EnsureKey() first.");
            return _d;
        }

        static string Base64UrlNoPad(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }
    }
}
