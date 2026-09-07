import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/models/pairing_api.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/pairing_session_repository.dart';
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

class _FakeIdentity implements AuthTokenProvider, AuthenticatedIdentityProvider {
  String? userId;
  String? token;

  @override
  String? get currentUserId => userId;

  @override
  Future<String?> validAccessToken() async => token;
}

({
  PairingSessionRepository repo,
  PhoneDeviceRepository phoneDevice,
  _FakeIdentity identity,
  _FakeKeyValueStore deviceKv,
  List<http.Request> requests,
})
_harness(
  Future<http.Response> Function(http.Request) handler, {
  NexaBackend? backendOverride,
}) {
  final requests = <http.Request>[];
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://nexa.example/'),
    httpClient: MockClient((request) async {
      requests.add(request);
      return handler(request);
    }),
  );
  final backend = backendOverride ?? NexaBackend(api);
  final identity = _FakeIdentity();
  final deviceKv = _FakeKeyValueStore();
  final phoneDevice = PhoneDeviceRepository(
    store: PhoneDeviceStore(deviceKv),
    backend: backend,
    tokenProvider: identity,
    identity: identity,
  );
  final repo = PairingSessionRepository(
    backend: backend,
    tokenProvider: identity,
    phoneDevice: phoneDevice,
  );
  return (
    repo: repo,
    phoneDevice: phoneDevice,
    identity: identity,
    deviceKv: deviceKv,
    requests: requests,
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

http.Response _pairingSessionResponse({
  String pairingSessionId = 'sess-1',
  String code = 'NX2.the-secret-pairing-code',
  String expiresAt = '2026-09-04T12:02:00.000Z',
}) => http.Response(
  jsonEncode({
    'pairingSessionId': pairingSessionId,
    'code': code,
    'expiresAt': expiresAt,
  }),
  201,
);

Future<http.Response> _router(http.Request r) async {
  if (r.url.path == '/v1/devices') return _registeredDeviceResponse();
  if (r.url.path == '/v1/pairing-sessions') return _pairingSessionResponse();
  throw StateError('unexpected path in test router: ${r.url.path}');
}

void main() {
  group('successful authenticated pairing-session creation', () {
    test('with an already-registered device: one call, to the right path, with the right body and token', () async {
      final h = _harness(_router);
      h.identity
        ..userId = 'user-1'
        ..token = 'the-supabase-token';
      await h.phoneDevice.ensureRegistered(); // pre-registers dev-1

      final session = await h.repo.createPairingSession(
        enrolmentHandle: 'the-enrolment-handle',
      );

      expect(session.pairingSessionId, 'sess-1');
      expect(session.code, 'NX2.the-secret-pairing-code');
      expect(session.expiresAt, DateTime.parse('2026-09-04T12:02:00.000Z'));

      final pairingRequest = h.requests.firstWhere((r) => r.url.path == '/v1/pairing-sessions');
      expect(pairingRequest.headers['authorization'], 'Bearer the-supabase-token');
      expect(jsonDecode(pairingRequest.body), {
        'phoneDeviceId': 'dev-1',
        'enrolmentHandle': 'the-enrolment-handle',
      });
    });

    test('with no device registered yet: registers one first, then creates the session — phoneDeviceId is resolved, never asked of the caller', () async {
      final h = _harness(_router);
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final session = await h.repo.createPairingSession(enrolmentHandle: 'handle');

      expect(session.pairingSessionId, 'sess-1');
      expect(h.requests.map((r) => r.url.path).toList(), [
        '/v1/devices',
        '/v1/pairing-sessions',
      ]);
      final pairingRequest = h.requests.last;
      expect(jsonDecode(pairingRequest.body), {
        'phoneDeviceId': 'dev-1',
        'enrolmentHandle': 'handle',
      });
    });
  });

  group('no registration without authentication', () {
    test('nobody signed in: throws NotAuthenticatedException before any network call', () async {
      final h = _harness((r) => fail('must not be called with no signed-in user'));

      await expectLater(
        h.repo.createPairingSession(enrolmentHandle: 'handle'),
        throwsA(isA<NotAuthenticatedException>()),
      );
      expect(h.requests, isEmpty);
    });

    test('signed in but the token resolves to null: throws NotAuthenticatedException before any network call', () async {
      final h = _harness((r) => fail('must not be called with no usable token'));
      h.identity.userId = 'user-1';

      await expectLater(
        h.repo.createPairingSession(enrolmentHandle: 'handle'),
        throwsA(isA<NotAuthenticatedException>()),
      );
      expect(h.requests, isEmpty);
    });
  });

  test('with no NexaBackend configured, throws BackendNotConfiguredException before any network call', () async {
    final identity = _FakeIdentity()
      ..userId = 'user-1'
      ..token = 'token';
    final phoneDevice = PhoneDeviceRepository(
      store: PhoneDeviceStore(_FakeKeyValueStore()),
      tokenProvider: identity,
      identity: identity,
    );
    final repo = PairingSessionRepository(
      tokenProvider: identity,
      phoneDevice: phoneDevice,
    );

    await expectLater(
      repo.createPairingSession(enrolmentHandle: 'handle'),
      throwsA(isA<BackendNotConfiguredException>()),
    );
  });

  group('backend status codes map the same way every other endpoint does', () {
    final cases = <int, NexaApiFailureKind>{
      400: NexaApiFailureKind.invalidRequest,
      401: NexaApiFailureKind.unauthorized,
      403: NexaApiFailureKind.forbidden,
      429: NexaApiFailureKind.rateLimited,
      500: NexaApiFailureKind.server,
    };

    for (final entry in cases.entries) {
      test('${entry.key} on POST /v1/pairing-sessions -> ${entry.value.name}', () async {
        final h = _harness((r) async {
          if (r.url.path == '/v1/devices') return _registeredDeviceResponse();
          return http.Response(jsonEncode({'error': 'x', 'message': 'y'}), entry.key);
        });
        h.identity
          ..userId = 'user-1'
          ..token = 'token';

        await expectLater(
          h.repo.createPairingSession(enrolmentHandle: 'handle'),
          throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', entry.value)),
        );
      });
    }
  });

  test('a malformed response (missing fields) throws rather than returning a half-built session', () async {
    // NexaBackend.createPairingSession / PairingSession.fromJson do not
    // wrap a shape mismatch into NexaApiException the way
    // SupabaseAuthClient's own decode path does (see the report) — a
    // missing field surfaces as a raw TypeError from the field cast. Either
    // way, what matters here holds: no PairingSession is ever returned with
    // a field silently defaulted or absent.
    final h = _harness((r) async {
      if (r.url.path == '/v1/devices') return _registeredDeviceResponse();
      return http.Response(jsonEncode({'pairingSessionId': 'sess-1'}), 201); // missing code/expiresAt
    });
    h.identity
      ..userId = 'user-1'
      ..token = 'token';

    await expectLater(
      h.repo.createPairingSession(enrolmentHandle: 'handle'),
      throwsA(isA<TypeError>()),
    );
  });

  group('the pairing code is never persisted or leaked', () {
    test('the code never appears anywhere in phone-device secure storage', () async {
      final h = _harness(_router);
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final session = await h.repo.createPairingSession(enrolmentHandle: 'handle');

      for (final stored in h.deviceKv.values.values) {
        expect(stored, isNot(contains(session.code)));
      }
    });

    test('toString() never includes the code', () async {
      final h = _harness(_router);
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final session = await h.repo.createPairingSession(enrolmentHandle: 'handle');
      final text = session.toString();

      expect(text, isNot(contains(session.code)));
      expect(text, contains('redacted'));
    });

    test('no bearer token appears anywhere PairingSession could be printed or serialized', () async {
      final h = _harness(_router);
      h.identity
        ..userId = 'user-1'
        ..token = 'a-real-supabase-access-token-value';

      final session = await h.repo.createPairingSession(enrolmentHandle: 'handle');

      expect(session.toString(), isNot(contains('a-real-supabase-access-token-value')));
    });
  });

  group('expiry metadata', () {
    test('is preserved exactly as the backend sent it, unaltered', () async {
      final h = _harness(
        (r) async {
          if (r.url.path == '/v1/devices') return _registeredDeviceResponse();
          return _pairingSessionResponse(expiresAt: '2026-09-04T12:07:30.500Z');
        },
      );
      h.identity
        ..userId = 'user-1'
        ..token = 'token';

      final session = await h.repo.createPairingSession(enrolmentHandle: 'handle');

      expect(session.expiresAt, DateTime.parse('2026-09-04T12:07:30.500Z'));
    });

    test('isExpired reflects the backend-provided expiry, not a locally-assumed 2 minutes', () {
      final issuedAt = DateTime.parse('2026-09-04T12:00:00.000Z');
      final session = PairingSession(
        pairingSessionId: 'sess-1',
        code: 'NX2.x',
        expiresAt: issuedAt.add(const Duration(minutes: 2)),
      );

      expect(session.isExpired(now: issuedAt.add(const Duration(minutes: 1))), isFalse);
      expect(session.isExpired(now: issuedAt.add(const Duration(minutes: 2, seconds: 1))), isTrue);
    });
  });

  test('concurrent creation over the same handle: exactly one succeeds, deterministically matching the backend — no client-side caching masks either call', () async {
    var pairingCalls = 0;
    final h = _harness((r) async {
      if (r.url.path == '/v1/devices') return _registeredDeviceResponse();
      pairingCalls++;
      if (pairingCalls == 1) return _pairingSessionResponse();
      // The second call over the same handle: the backend's own atomic
      // consumption (PairingSessionStore.create) is what actually produces
      // this, in reality — mocked here to prove this repository does not
      // interfere with it either way.
      return http.Response(jsonEncode({'error': 'invalid_request', 'message': 'used'}), 400);
    });
    h.identity
      ..userId = 'user-1'
      ..token = 'token';
    await h.phoneDevice.ensureRegistered();

    final outcomes = await Future.wait([
      h.repo
          .createPairingSession(enrolmentHandle: 'same-handle')
          .then<Object>((v) => v)
          .catchError((Object e) => e),
      h.repo
          .createPairingSession(enrolmentHandle: 'same-handle')
          .then<Object>((v) => v)
          .catchError((Object e) => e),
    ]);

    expect(outcomes.whereType<PairingSession>().length, 1);
    expect(outcomes.whereType<NexaApiException>().length, 1);
    // Both calls genuinely reached the network — this repository does not
    // cache or de-duplicate the way PhoneDeviceRepository.ensureRegistered
    // deliberately does, because a pairing session is not that kind of
    // resource.
    expect(pairingCalls, 2);
  });
}
