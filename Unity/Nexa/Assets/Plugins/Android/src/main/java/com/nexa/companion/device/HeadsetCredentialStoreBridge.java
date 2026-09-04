package com.nexa.companion.device;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Encrypts a headset's application credentials (its post-pairing device id, access token and
 * refresh token — never the P-256 private key) at rest, using an AES-256-GCM key held entirely
 * inside Android Keystore.
 *
 * <p>Deliberately a second, independent mechanism from {@link com.nexa.companion.identity.HeadsetIdentityBridge}:
 * that class's Keystore entry holds the headset's signing key and is never asked to encrypt or
 * decrypt anything else. This class's Keystore entry (a different alias, a different key type —
 * a symmetric AES key rather than an EC key pair) exists only to protect the plaintext JSON blob
 * this class writes to {@link SharedPreferences}. Neither class can be used to reach the other's
 * secret, so a bug in one cannot leak the other.</p>
 *
 * <p>The plaintext itself — device id, access token, refresh token — is never held by this class
 * beyond one {@link #save}/{@link #load} call; only the Base64-encoded (IV || ciphertext) ever
 * touches disk. Called from Unity C# via {@code AndroidJavaObject}/{@code AndroidJavaClass} — see
 * {@code Nexa.Pairing.AndroidHeadsetCredentialStore} on the C# side, which is also what turns
 * {@code DeviceCredentials} into the plain JSON string every method here actually operates on;
 * this class knows nothing about that C# type.</p>
 */
public final class HeadsetCredentialStoreBridge {

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";

    /** A dedicated alias, distinct from HeadsetIdentityBridge's own — see the class doc. */
    private static final String KEY_ALIAS = "nexa.headset.credential_store.v1";

    private static final String PREFS_FILE_NAME = "nexa_headset_credentials";
    private static final String PREFS_VALUE_KEY = "ciphertext_v1";

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_IV_LENGTH_BYTES = 12;
    private static final int AES_KEY_SIZE_BITS = 256;

    private HeadsetCredentialStoreBridge() {
    }

    /** Whether a credential blob is currently stored, without decrypting it. */
    public static boolean hasCredentials(Context context) {
        return prefs(context).contains(PREFS_VALUE_KEY);
    }

    /**
     * Encrypts {@code plaintextJson} and stores it, replacing whatever was stored before.
     * Generates the Keystore-held AES key on first use if it does not already exist — the same
     * "generate once, reuse thereafter" behaviour {@code HeadsetIdentityBridge.ensureKey} has for
     * the signing key, except this method performs it implicitly rather than requiring a separate
     * call, since nothing about protecting a device credential needs the two-step
     * check-then-generate shape a signing key's own public identity does.
     */
    public static void save(Context context, String plaintextJson) throws Exception {
        SecretKey key = ensureKey();

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        // GCM: with no IV supplied to init(), the provider generates a fresh random one — read
        // back here rather than generated separately, so this is always the exact IV that
        // encryption actually used.
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(plaintextJson.getBytes("UTF-8"));

        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);

        String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);
        prefs(context).edit().putString(PREFS_VALUE_KEY, encoded).apply();
    }

    /**
     * Decrypts and returns whatever was stored by {@link #save}. Throws if nothing is stored —
     * callers check {@link #hasCredentials} first, the same contract every other store in this
     * codebase documents for the same reason.
     */
    public static String load(Context context) throws Exception {
        String encoded = prefs(context).getString(PREFS_VALUE_KEY, null);
        if (encoded == null) {
            throw new IllegalStateException("No credentials stored — call save() first, or check hasCredentials().");
        }

        byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
        if (combined.length <= GCM_IV_LENGTH_BYTES) {
            throw new IllegalStateException("Stored credential blob is shorter than a valid IV+ciphertext.");
        }

        byte[] iv = new byte[GCM_IV_LENGTH_BYTES];
        byte[] ciphertext = new byte[combined.length - GCM_IV_LENGTH_BYTES];
        System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH_BYTES);
        System.arraycopy(combined, GCM_IV_LENGTH_BYTES, ciphertext, 0, ciphertext.length);

        SecretKey key = requireKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, "UTF-8");
    }

    /**
     * Removes the stored blob. Deliberately does not delete the Keystore key itself — a later
     * {@link #save} reusing the same key is safe, since GCM's fresh random IV on every encryption
     * keeps every ciphertext this class ever produces distinct regardless of key reuse across
     * calls, the same property that makes IV reuse (not key reuse) the actual hazard GCM warns
     * against.
     */
    public static void clear(Context context) {
        prefs(context).edit().remove(PREFS_VALUE_KEY).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_FILE_NAME, Context.MODE_PRIVATE);
    }

    private static SecretKey ensureKey() throws Exception {
        KeyStore keyStore = openKeyStore();
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(AES_KEY_SIZE_BITS)
                .build();
        generator.init(spec);
        return generator.generateKey();
    }

    private static SecretKey requireKey() throws Exception {
        KeyStore keyStore = openKeyStore();
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            throw new IllegalStateException("No credential-store key exists yet — call save() first.");
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private static KeyStore openKeyStore() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        return keyStore;
    }
}
