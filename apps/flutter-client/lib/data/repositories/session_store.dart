import 'dart:convert';

import '../models/auth_session.dart';
import 'secure_key_value_store.dart';

/// Persists at most one [AuthSession] — this phone's own.
///
/// One key, one JSON blob, behind whatever [SecureKeyValueStore] this was
/// built with. [read] is the one method this app calls on every startup —
/// see `AuthSessionRepository.restore` — so it treats absolutely any
/// failure to produce a usable session (missing value, corrupted JSON, a
/// stored shape from a previous version, or the platform store itself
/// failing to open) identically: return `null`. A damaged or unreadable
/// credential should make the app ask to sign in again, never crash on
/// startup.
class SessionStore {
  SessionStore(this._kv);

  final SecureKeyValueStore _kv;

  static const _key = 'nexa.auth.session.v1';

  Future<AuthSession?> read() async {
    try {
      final raw = await _kv.read(_key);
      if (raw == null) return null;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      return AuthSession.fromJson(decoded);
    } on Exception {
      // `FormatException` (not valid JSON) and the platform secure-storage
      // plugin itself failing to open (a real device issue, or simply no
      // platform binding registered — see the test suite, which exercises
      // this class purely through [SecureKeyValueStore] and never touches a
      // real platform channel) both land here.
      return null;
    } on TypeError {
      // Valid JSON, but missing or wrongly-typed a field `AuthSession.fromJson`
      // expects — a prior version's stored shape, most likely. `TypeError`
      // is deliberately caught on its own: it is an `Error`, not an
      // `Exception`, so the catch above does not already cover it, and this
      // is the one `Error` subtype this method treats as an expected,
      // recoverable outcome rather than a bug that should surface.
      return null;
    }
  }

  Future<void> write(AuthSession session) =>
      _kv.write(_key, jsonEncode(session.toJson()));

  Future<void> clear() => _kv.delete(_key);
}
