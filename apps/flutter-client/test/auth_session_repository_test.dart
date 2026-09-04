import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/auth_session.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';
import 'package:nexa_client/data/repositories/session_store.dart';
import 'package:nexa_client/data/repositories/supabase_auth_client.dart';

/// The same fake used by `session_store_test.dart`, redeclared here rather
/// than shared across test files — small enough that a second copy is
/// cheaper than a cross-file test dependency.
class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

AuthSession _session({Duration fromNow = const Duration(hours: 1)}) =>
    AuthSession(
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: DateTime.now().add(fromNow),
      userId: 'user-1',
    );

/// A repository wired to a mocked Supabase transport, so a test can drive
/// real sign-in/refresh/logout logic without a network.
({
  AuthSessionRepository repo,
  SessionStore store,
  Future<http.Request> Function() lastRequest,
})
_harness(Future<http.Response> Function(http.Request) handler) {
  http.Request? seen;
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://project-ref.supabase.co/'),
    httpClient: MockClient((request) async {
      seen = request;
      return handler(request);
    }),
  );
  final authClient = SupabaseAuthClient(
    SupabaseAuthConfig(
      projectUrl: Uri.parse('https://project-ref.supabase.co/'),
      anonKey: 'anon-key',
    ),
    apiClient: api,
  );
  final store = SessionStore(_FakeKeyValueStore());
  final repo = AuthSessionRepository(
    sessionStore: store,
    authClient: authClient,
  );
  return (repo: repo, store: store, lastRequest: () async => seen!);
}

http.Response _tokenResponse({
  String accessToken = 'fresh-access-token',
  String refreshToken = 'fresh-refresh-token',
  int expiresIn = 3600,
}) => http.Response(
  jsonEncode({
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'token_type': 'bearer',
    'expires_in': expiresIn,
    'user': {'id': 'user-1'},
  }),
  200,
);

void main() {
  group('a repository with no SupabaseAuthConfig at all', () {
    test('never fabricates a session — every real-auth call throws AuthNotConfiguredException', () async {
      final repo = AuthSessionRepository(
        sessionStore: SessionStore(_FakeKeyValueStore()),
      );

      await expectLater(
        repo.signInWithPassword(email: 'x@example.com', password: 'y'),
        throwsA(isA<AuthNotConfiguredException>()),
      );
      expect(repo.current, isNull);
      expect(repo.isSignedIn, isFalse);
    });

    test('restore() and logout() are still safe with nothing configured', () async {
      final repo = AuthSessionRepository(
        sessionStore: SessionStore(_FakeKeyValueStore()),
      );

      await repo.restore();
      expect(repo.current, isNull);

      await repo.logout(); // must not throw
      expect(repo.current, isNull);
    });

    test('validAccessToken() with no session returns null without touching the network', () async {
      final repo = AuthSessionRepository(
        sessionStore: SessionStore(_FakeKeyValueStore()),
      );

      expect(await repo.validAccessToken(), isNull);
    });
  });

  group('restore', () {
    test('loads a session written by a previous run into memory', () async {
      final h = _harness((r) async => _tokenResponse());
      await h.store.write(_session());

      expect(h.repo.current, isNull); // nothing until restore() runs
      await h.repo.restore();

      expect(h.repo.current, isNotNull);
      expect(h.repo.current!.accessToken, 'access-1');
    });

    test('with nothing persisted, current stays null and no network call happens', () async {
      final h = _harness((r) => fail('should not be called'));

      await h.repo.restore();

      expect(h.repo.current, isNull);
    });
  });

  group('signInWithPassword', () {
    test('a successful sign-in updates current and persists to the store', () async {
      final h = _harness((r) async => _tokenResponse());

      await h.repo.signInWithPassword(email: 'x@example.com', password: 'y');

      expect(h.repo.current, isNotNull);
      expect(h.repo.current!.accessToken, 'fresh-access-token');
      expect((await h.store.read())?.accessToken, 'fresh-access-token');
    });
  });

  group('logout', () {
    test('clears current, clears the store, and best-effort signs out server-side', () async {
      final h = _harness((r) async => http.Response('', 204));
      await h.store.write(_session());
      await h.repo.restore();
      expect(h.repo.current, isNotNull);

      await h.repo.logout();

      expect(h.repo.current, isNull);
      expect(await h.store.read(), isNull);
      final request = await h.lastRequest();
      expect(request.url.path, '/auth/v1/logout');
    });

    test('is a safe no-op when nothing was ever signed in', () async {
      final h = _harness((r) => fail('should not be called with no session'));

      await h.repo.logout(); // must not throw, must not call the network
      expect(h.repo.current, isNull);
    });
  });

  group('validAccessToken', () {
    test('returns the current token directly when it is not close to expiry', () async {
      final h = _harness((r) => fail('should not refresh a token that is still fresh'));
      await h.store.write(_session(fromNow: const Duration(hours: 1)));
      await h.repo.restore();

      expect(await h.repo.validAccessToken(), 'access-1');
    });

    test('refreshes transparently when the held token is expired, and persists the result', () async {
      final h = _harness(
        (r) async => _tokenResponse(accessToken: 'rotated-access', refreshToken: 'rotated-refresh'),
      );
      await h.store.write(_session(fromNow: const Duration(seconds: -5)));
      await h.repo.restore();

      final token = await h.repo.validAccessToken();

      expect(token, 'rotated-access');
      final request = await h.lastRequest();
      expect(request.url.queryParameters['grant_type'], 'refresh_token');
      expect(jsonDecode(request.body), {'refresh_token': 'refresh-1'});
      expect((await h.store.read())?.accessToken, 'rotated-access');
      expect(h.repo.current?.refreshToken, 'rotated-refresh');
    });

    test('a dead refresh token drops the session and returns null rather than throwing', () async {
      final h = _harness(
        (r) async => http.Response(jsonEncode({'error': 'invalid_grant', 'message': 'expired'}), 400),
      );
      await h.store.write(_session(fromNow: const Duration(seconds: -5)));
      await h.repo.restore();

      final token = await h.repo.validAccessToken();

      expect(token, isNull);
      expect(h.repo.current, isNull);
      expect(await h.store.read(), isNull);
    });
  });

  group('the session boundary actually reaches NexaBackend', () {
    test('a token resolved from AuthSessionRepository is the one an authenticated NexaBackend call sends', () async {
      final h = _harness((r) async => _tokenResponse());
      await h.store.write(_session(fromNow: const Duration(hours: 1)));
      await h.repo.restore();

      http.Request? backendRequest;
      final backend = NexaBackend(
        NexaApiClient(
          baseUrl: Uri.parse('https://nexa.example/'),
          httpClient: MockClient((request) async {
            backendRequest = request;
            return http.Response(
              jsonEncode({
                'deviceId': 'dev-1',
                'kind': 'phone',
                'label': null,
                'registeredAt': '2026-09-03T12:00:00.000Z',
              }),
              201,
            );
          }),
        ),
      );

      // This is the seam the report describes: NexaBackend never reads
      // AuthSessionRepository itself — a caller resolves a token from it
      // first, exactly as this does.
      final token = await h.repo.validAccessToken();
      expect(token, isNotNull);
      await backend.registerDevice(bearerToken: token!);

      expect(backendRequest!.headers['authorization'], 'Bearer access-1');
    });
  });
}
