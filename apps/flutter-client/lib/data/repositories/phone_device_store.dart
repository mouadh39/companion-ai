import 'dart:convert';

import '../models/phone_device.dart';
import 'secure_key_value_store.dart';

/// Persists at most one [LocalPhoneDevice] — this installation's own.
///
/// Shares [SecureKeyValueStore] with [SessionStore] rather than a plain
/// `SharedPreferences`-backed store — `phoneDeviceId` itself is not a
/// secret, but reusing the one storage abstraction this app already has,
/// already tests, and already trusts is simpler than adding a second
/// dependency to draw a distinction nothing here needs drawn. A different
/// key from `SessionStore`'s, so the two can never collide or be read as
/// each other's value.
///
/// Same failure handling as `SessionStore.read` and for the same reason: a
/// missing value, corrupted JSON, a stored shape from a previous version,
/// or the platform store itself failing to open are all "no device on
/// record," never a crash.
class PhoneDeviceStore {
  PhoneDeviceStore(this._kv);

  final SecureKeyValueStore _kv;

  static const _key = 'nexa.device.phone.v1';

  Future<LocalPhoneDevice?> read() async {
    try {
      final raw = await _kv.read(_key);
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      return LocalPhoneDevice.fromJson(decoded);
    } on Exception {
      return null;
    } on TypeError {
      return null;
    }
  }

  Future<void> write(LocalPhoneDevice device) =>
      _kv.write(_key, jsonEncode(device.toJson()));

  Future<void> clear() => _kv.delete(_key);
}
