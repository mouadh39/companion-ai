namespace Nexa.Pairing
{
    /// <summary>
    /// Holds at most one validated pairing code, briefly, entirely in process memory.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Not a cache, not a queue, not a history — one slot, meant to live for the handful of
    /// seconds between a successful scan and whatever the next pairing stage (the future
    /// challenge/signing step this codebase does not implement yet) does with it. Nothing here
    /// ever writes to disk, ever logs, and ever survives process exit — see the class this
    /// replaces no equivalent of: there is deliberately no <c>Save</c>, no <c>Serialize</c>, no
    /// constructor parameter naming a file or a key-value store. A pairing code is exactly as
    /// sensitive as the enrolment handle it names (see
    /// <c>apps/backend/src/devices/challenge.ts</c>'s own module doc on why that handle is
    /// single-use and short-lived on the backend's own terms already) — this type's whole job is
    /// to not make it live any longer, or anywhere else, than that.
    /// </para>
    /// <para>
    /// <see cref="Take"/> is the only way to read the code out, and it clears the slot as it
    /// does — a caller that reads it is expected to be about to consume it, not to keep checking
    /// back.
    /// </para>
    /// </remarks>
    public sealed class PendingPairingCode
    {
        string _code;

        /// <summary>Whether a code is currently held, without reading or clearing it.</summary>
        public bool HasCode => _code != null;

        /// <summary>
        /// Replaces whatever is held with <paramref name="validatedCode"/>. The caller is
        /// entirely responsible for having already validated it — see
        /// <see cref="PairingCodeValidator"/> — this method does not re-check it, the same way
        /// <c>IHeadsetIdentity.Sign</c> does not re-check the challenge it is given.
        /// </summary>
        public void Set(string validatedCode)
        {
            if (string.IsNullOrEmpty(validatedCode))
                throw new System.ArgumentException("A pending pairing code must not be null or empty.", nameof(validatedCode));

            _code = validatedCode;
        }

        /// <summary>
        /// Reads and clears the held code in one step. Returns <c>null</c> if nothing is held —
        /// callers check <see cref="HasCode"/> first if the distinction between "nothing yet"
        /// and "already taken" matters to them.
        /// </summary>
        public string Take()
        {
            string code = _code;
            _code = null;
            return code;
        }

        /// <summary>Discards whatever is held without returning it — e.g. when a pairing attempt is abandoned.</summary>
        public void Clear() => _code = null;

        /// <summary>Deliberately never includes the code itself — see the class doc.</summary>
        public override string ToString() => $"PendingPairingCode(hasCode: {HasCode})";
    }
}
