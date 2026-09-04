import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// A single encrypted value, addressed by key.
///
/// [SessionStore] is written against this rather than against
/// `FlutterSecureStorage` directly, for the same reason every repository in
/// this app sits behind an interface: a test substitutes an in-memory fake
/// and never touches a platform channel, which a real secure-storage plugin
/// cannot run under in `flutter test` at all.
abstract interface class SecureKeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Backed by the platform's real secure storage: on Android, values are
/// encrypted with a key held in the Android Keystore before ever reaching
/// disk; on iOS, the Keychain. Defaults are left as the plugin sets them —
/// `flutter_secure_storage` 10.x resolves the actual Android cipher itself
/// rather than taking it as a constructor option.
///
/// This is the one place in the app that is allowed to hold a Nexa session
/// on disk at all. Nothing about a session ever goes through
/// `SharedPreferences`, a plain file, or any other unencrypted store — see
/// the module doc on why plaintext is never an acceptable fallback for a
/// credential.
class PlatformSecureKeyValueStore implements SecureKeyValueStore {
  PlatformSecureKeyValueStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
