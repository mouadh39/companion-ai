import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/auth_session.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';
import 'package:nexa_client/data/repositories/session_store.dart';

/// An in-memory stand-in for the real, platform-channel-backed secure
/// storage — [SessionStore] is written against [SecureKeyValueStore]
/// precisely so a test can do this instead of touching Android Keystore or
/// iOS Keychain, neither of which `flutter test` can reach at all.
class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  /// Set directly by a test that wants to simulate a value already on disk
  /// — including a corrupted one — without going through [write].
  void seed(String key, String value) => _values[key] = value;

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

class _ThrowingKeyValueStore implements SecureKeyValueStore {
  @override
  Future<String?> read(String key) => throw Exception('platform channel unavailable');

  @override
  Future<void> write(String key, String value) => throw Exception('platform channel unavailable');

  @override
  Future<void> delete(String key) => throw Exception('platform channel unavailable');
}

void main() {
  AuthSession session() => AuthSession(
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
    userId: 'user-1',
  );

  test('read() before anything is written returns null', () async {
    final store = SessionStore(_FakeKeyValueStore());
    expect(await store.read(), isNull);
  });

  test('a written session round-trips through read()', () async {
    final kv = _FakeKeyValueStore();
    final store = SessionStore(kv);
    final original = session();

    await store.write(original);
    final restored = await store.read();

    expect(restored, isNotNull);
    expect(restored!.accessToken, original.accessToken);
    expect(restored.refreshToken, original.refreshToken);
    expect(restored.userId, original.userId);
  });

  test('clear() removes what was written', () async {
    final kv = _FakeKeyValueStore();
    final store = SessionStore(kv);

    await store.write(session());
    await store.clear();

    expect(await store.read(), isNull);
  });

  test('the underlying store never sees plaintext token values as its key — only the session blob as its value', () async {
    final kv = _FakeKeyValueStore();
    final store = SessionStore(kv);
    await store.write(session());

    // Whatever key SessionStore chose, it is not one of the token values
    // themselves — this locks in that tokens are stored as data, never as
    // an addressable key a second reader could enumerate.
    expect(kv._values.keys, isNot(contains('access-1')));
    expect(kv._values.keys, isNot(contains('refresh-1')));
  });

  test('a value that is not JSON at all is treated as no session, not a crash', () async {
    final kv = _FakeKeyValueStore()..seed('nexa.auth.session.v1', 'not json at all');
    final store = SessionStore(kv);

    expect(await store.read(), isNull);
  });

  test('valid JSON missing a field SessionStore needs is treated as no session', () async {
    final kv = _FakeKeyValueStore()
      ..seed('nexa.auth.session.v1', '{"accessToken":"a"}');
    final store = SessionStore(kv);

    expect(await store.read(), isNull);
  });

  test('a JSON array instead of an object is treated as no session', () async {
    final kv = _FakeKeyValueStore()..seed('nexa.auth.session.v1', '[1,2,3]');
    final store = SessionStore(kv);

    expect(await store.read(), isNull);
  });

  test('the underlying secure store failing outright is treated as no session, not a crash', () async {
    final store = SessionStore(_ThrowingKeyValueStore());

    expect(await store.read(), isNull);
  });
}
