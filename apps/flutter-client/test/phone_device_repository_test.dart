import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/models/phone_device.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/phone_device_repository.dart';
import 'package:nexa_client/data/repositories/phone_device_store.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';

class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> values = {};

  @override
  Future<String?> read(String key) async => values[key];

  @override
  Future<void> write(String key, String value) async => values[key] = value;

  @override
  Future<void> delete(String key) async => values.remove(key);
}

/// A fully controllable stand-in for whatever holds the real session — no
/// Supabase, no network, just what `PhoneDeviceRepository` is actually
/// written against.
class _FakeIdentity implements AuthTokenProvider, AuthenticatedIdentityProvider {
  String? userId;
  String? token;
  int tokenCalls = 0;

  @override
  String? get currentUserId => userId;

  @override
  Future<String?> validAccessToken() async {
    tokenCalls++;
    return token;
  }
}

({
  PhoneDeviceRepository repo,
  PhoneDeviceStore store,
  _FakeIdentity identity,
  Future<http.Request> Function() lastRequest,
  int Function() callCount,
})
_harness(Future<http.Response> Function(http.Request) handler) {
  final requests = <http.Request>[];
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://nexa.example/'),
    httpClient: MockClient((request) async {
      requests.add(request);
      return handler(request);
    }),
  );
  final store = PhoneDeviceStore(_FakeKeyValueStore());
  final identity = _FakeIdentity();
  final repo = PhoneDeviceRepository(
    store: store,
    backend: NexaBackend(api),
    tokenProvider: identity,
    identity: identity,
  );
  return (
    repo: repo,
    store: store,
    identity: identity,
    lastRequest: () async => requests.last,
    callCount: () => requests.length,
  );
}

http.Response _registeredDeviceResponse({String deviceId = 'dev-1'}) =>
    http.Response(
      jsonEncode({
        'deviceId': deviceId,
        'kind': 'phone',
        'label': null,
        'registeredAt': '2026-09-04T12:00:00.000Z',
      }),
      201,
    );

void main() {
  group('ensureRegistered — successful registration', () {
    test('calls POST /v1/devices with the bearer token and returns the new id', () async {
      final h = _harness((r) async => _registeredDeviceResponse());
      h.identity
        ..userId = 'user-1'
        ..token = 'the-supabase-token';

      final id = await h.repo.ensureRegistered(label: 'My phone');

      expect(id, 'dev-1');
      final request = await h.lastRequest();
      expect(request.url.path, '/v1/devices');
      expect(request.headers['authorization'], 'Bearer the-supabase-token');
      expect(jsonDecode(request.body), {'label': 'My phone'});
    });

    test('persists the returned device id, tagged with the account it belongs to', () async {
      final h = _harness((r) async => _registeredDeviceResponse());
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      await h.repo.ensureRegistered();

      final stored = await h.store.read();
      expect(stored, isNotNull);
      expect(stored!.phoneDeviceId, 'dev-1');
      expect(stored.userId, 'user-1');
    });
  });

  group('no registration without authentication', () {
    test('throws NotAuthenticatedException when nobody is signed in, and calls the network never', () async {
      final h = _harness((r) => fail('must not be called with no signed-in user'));

      await expectLater(
        h.repo.ensureRegistered(),
        throwsA(isA<NotAuthenticatedException>()),
      );
    });

    test('throws NotAuthenticatedException when signed in but the token resolves to null', () async {
      final h = _harness((r) => fail('must not be called with no usable token'));
      h.identity.userId = 'user-1'; // signed in, but token is null (e.g. refresh failed)

      await expectLater(
        h.repo.ensureRegistered(),
        throwsA(isA<NotAuthenticatedException>()),
      );
    });
  });

  test('with no NexaBackend configured, throws BackendNotConfiguredException', () async {
    final identity = _FakeIdentity()
      ..userId = 'user-1'
      ..token = 'token';
    final repo = PhoneDeviceRepository(
      store: PhoneDeviceStore(_FakeKeyValueStore()),
      tokenProvider: identity,
      identity: identity,
    );

    await expectLater(
      repo.ensureRegistered(),
      throwsA(isA<BackendNotConfiguredException>()),
    );
  });

  group('avoiding duplicate registration', () {
    test('a second in-memory call returns the cached id without a second network call', () async {
      final h = _harness((r) async => _registeredDeviceResponse());
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final first = await h.repo.ensureRegistered();
      final second = await h.repo.ensureRegistered();

      expect(first, second);
      expect(h.callCount(), 1);
    });

    test('a restored device id for the same user prevents a fresh registration on next launch', () async {
      final h = _harness((r) => fail('must not register again — a valid id was already restored'));
      h.identity.userId = 'user-1';
      await h.store.write(const LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'already-registered'));

      await h.repo.restore();
      final id = await h.repo.ensureRegistered();

      expect(id, 'already-registered');
      expect(h.repo.phoneDeviceId, 'already-registered');
    });

    test('concurrent calls before the first resolves share one registration', () async {
      var calls = 0;
      final h = _harness((r) async {
        calls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return _registeredDeviceResponse();
      });
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final results = await Future.wait([
        h.repo.ensureRegistered(),
        h.repo.ensureRegistered(),
        h.repo.ensureRegistered(),
      ]);

      expect(calls, 1);
      expect(results.toSet(), {'dev-1'});
    });
  });

  group('restoration on startup', () {
    test('restore() loads a stored id for the currently signed-in user into phoneDeviceId', () async {
      final h = _harness((r) => fail('should not be called'));
      h.identity.userId = 'user-1';
      await h.store.write(const LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'dev-1'));

      expect(h.repo.phoneDeviceId, isNull); // nothing until restore() runs
      await h.repo.restore();

      expect(h.repo.phoneDeviceId, 'dev-1');
    });

    test('restore() with nothing persisted leaves phoneDeviceId null', () async {
      final h = _harness((r) => fail('should not be called'));
      h.identity.userId = 'user-1';

      await h.repo.restore();

      expect(h.repo.phoneDeviceId, isNull);
    });

    test('a stored id for a DIFFERENT account is never loaded — no cross-account reuse', () async {
      final h = _harness((r) async => _registeredDeviceResponse(deviceId: 'dev-for-bob'));
      await h.store.write(const LocalPhoneDevice(userId: 'alice', phoneDeviceId: 'dev-for-alice'));
      h.identity
        ..userId = 'bob'
        ..token = 'token';

      await h.repo.restore();
      expect(h.repo.phoneDeviceId, isNull);

      // Bob genuinely gets his own device registered — Alice's id is never
      // silently handed to him.
      final id = await h.repo.ensureRegistered();
      expect(id, 'dev-for-bob');

      final storedNow = await h.store.read();
      expect(storedNow!.userId, 'bob');
      expect(storedNow.phoneDeviceId, 'dev-for-bob');
    });

    test('a stored id for nobody currently signed in is not loaded either', () async {
      final h = _harness((r) => fail('should not be called'));
      await h.store.write(const LocalPhoneDevice(userId: 'alice', phoneDeviceId: 'dev-1'));
      // h.identity.userId left null: nobody signed in.

      await h.repo.restore();

      expect(h.repo.phoneDeviceId, isNull);
    });
  });

  group('backend failure', () {
    test('a 500 from POST /v1/devices propagates as NexaApiException, leaving no local state behind', () async {
      final h = _harness((r) async => http.Response('{"error":"x"}', 500));
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      await expectLater(h.repo.ensureRegistered(), throwsA(isA<NexaApiException>()));

      expect(h.repo.phoneDeviceId, isNull);
      expect(await h.store.read(), isNull);
    });

    test('a failed attempt does not poison later attempts — a following call can still succeed', () async {
      var first = true;
      final h = _harness((r) async {
        if (first) {
          first = false;
          return http.Response('{"error":"x"}', 500);
        }
        return _registeredDeviceResponse();
      });
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      await expectLater(h.repo.ensureRegistered(), throwsA(isA<NexaApiException>()));
      final id = await h.repo.ensureRegistered();

      expect(id, 'dev-1');
    });
  });

  group('revoked/invalid device recovery', () {
    test('discardStoredDevice clears both memory and disk, so the next call registers fresh', () async {
      final h = _harness((r) async => _registeredDeviceResponse(deviceId: 'brand-new-dev'));
      h.identity
        ..userId = 'user-1'
        ..token = 'token';
      await h.store.write(const LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'revoked-dev'));
      await h.repo.restore();
      expect(h.repo.phoneDeviceId, 'revoked-dev');

      // Something elsewhere learned this id no longer works — the only way
      // that can happen, since POST /v1/devices itself has no way to ask.
      await h.repo.discardStoredDevice();

      expect(h.repo.phoneDeviceId, isNull);
      expect(await h.store.read(), isNull);

      final freshId = await h.repo.ensureRegistered();
      expect(freshId, 'brand-new-dev');
    });
  });

  group('logout clears the active association appropriately', () {
    test('clearActiveDevice drops the in-memory id but leaves the stored record untouched', () async {
      final h = _harness((r) => fail('should not be called'));
      h.identity.userId = 'user-1';
      await h.store.write(const LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'dev-1'));
      await h.repo.restore();
      expect(h.repo.phoneDeviceId, 'dev-1');

      h.repo.clearActiveDevice();

      expect(h.repo.phoneDeviceId, isNull);
      // Still on disk — restore() will pick it back up if the same account
      // signs back in.
      expect((await h.store.read())?.phoneDeviceId, 'dev-1');
    });

    test('the same account signing back in after clearActiveDevice reuses the stored id, not a fresh one', () async {
      final h = _harness((r) => fail('must not re-register — the stored id is still good'));
      h.identity.userId = 'user-1';
      await h.store.write(const LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'dev-1'));
      await h.repo.restore();

      h.repo.clearActiveDevice(); // "logout"
      await h.repo.restore(); // "logged back in as the same user"

      expect(h.repo.phoneDeviceId, 'dev-1');
    });
  });

  test('no token ever appears in the persisted or in-memory device record', () async {
    final h = _harness((r) async => _registeredDeviceResponse());
    h.identity
      ..userId = 'user-1'
      ..token = 'a-real-supabase-access-token-value';

    await h.repo.ensureRegistered();

    final stored = await h.store.read();
    final serialised = jsonEncode(stored!.toJson());
    expect(serialised, isNot(contains('a-real-supabase-access-token-value')));
    expect(stored.toJson().keys, {'userId', 'phoneDeviceId'});
  });
}
