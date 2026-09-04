import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/supabase_auth_client.dart';

({SupabaseAuthClient client, Future<http.Request> Function() lastRequest}) _harness(
  Future<http.Response> Function(http.Request) handler,
) {
  http.Request? seen;
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://project-ref.supabase.co/'),
    httpClient: MockClient((request) async {
      seen = request;
      return handler(request);
    }),
  );
  final client = SupabaseAuthClient(
    // The transport is overridden by `apiClient` below, so this URL is
    // never actually dialed — it exists only because SupabaseAuthConfig
    // requires one.
    SupabaseAuthConfig(
      projectUrl: Uri.parse('https://project-ref.supabase.co/'),
      anonKey: 'the-anon-key',
    ),
    apiClient: api,
  );
  return (client: client, lastRequest: () async => seen!);
}

http.Response _tokenResponse({int expiresIn = 3600}) => http.Response(
  jsonEncode({
    'access_token': 'the-access-token',
    'refresh_token': 'the-refresh-token',
    'token_type': 'bearer',
    'expires_in': expiresIn,
    'user': {'id': 'user-1', 'email': 'someone@example.com'},
  }),
  200,
);

void main() {
  group('signInWithPassword', () {
    test('POSTs to the password grant with apikey and no bearer token', () async {
      final h = _harness((r) async => _tokenResponse());

      final session = await h.client.signInWithPassword(
        email: 'someone@example.com',
        password: 'the-password',
      );

      final request = await h.lastRequest();
      expect(request.url.path, '/auth/v1/token');
      expect(request.url.queryParameters['grant_type'], 'password');
      expect(request.headers['apikey'], 'the-anon-key');
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(jsonDecode(request.body), {
        'email': 'someone@example.com',
        'password': 'the-password',
      });

      expect(session.accessToken, 'the-access-token');
      expect(session.refreshToken, 'the-refresh-token');
      expect(session.userId, 'user-1');
    });

    test('a rejected password raises NexaApiException, not a fabricated session', () async {
      final h = _harness(
        (r) async => http.Response(
          jsonEncode({'error': 'invalid_grant', 'message': 'Invalid login credentials'}),
          400,
        ),
      );

      await expectLater(
        h.client.signInWithPassword(email: 'x@example.com', password: 'wrong'),
        throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.invalidRequest)),
      );
    });

    test('a response missing a field this app needs raises decodeFailed rather than a half-built session', () async {
      final h = _harness(
        (r) async => http.Response(
          jsonEncode({'access_token': 'a', 'user': {'id': 'user-1'}}),
          200,
        ),
      );

      await expectLater(
        h.client.signInWithPassword(email: 'x@example.com', password: 'y'),
        throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.decodeFailed)),
      );
    });
  });

  group('refreshSession', () {
    test('POSTs to the refresh_token grant with the given refresh token', () async {
      final h = _harness((r) async => _tokenResponse(expiresIn: 1200));

      await h.client.refreshSession('a-still-live-refresh-token');

      final request = await h.lastRequest();
      expect(request.url.queryParameters['grant_type'], 'refresh_token');
      expect(jsonDecode(request.body), {'refresh_token': 'a-still-live-refresh-token'});
    });
  });

  group('signOut', () {
    test('sends the access token as a bearer header, and apikey alongside it', () async {
      final h = _harness((r) async => http.Response('', 204));

      await h.client.signOut('the-access-token');

      final request = await h.lastRequest();
      expect(request.url.path, '/auth/v1/logout');
      expect(request.headers['authorization'], 'Bearer the-access-token');
      expect(request.headers['apikey'], 'the-anon-key');
    });

    test('swallows a failure rather than throwing — signing out of this device must always succeed locally', () async {
      final h = _harness((r) async => http.Response('server on fire', 500));

      await expectLater(h.client.signOut('token'), completes);
    });
  });

  group('requestPasswordReset', () {
    test('POSTs the email to /auth/v1/recover', () async {
      final h = _harness((r) async => http.Response('', 200));

      await h.client.requestPasswordReset('someone@example.com');

      final request = await h.lastRequest();
      expect(request.url.path, '/auth/v1/recover');
      expect(jsonDecode(request.body), {'email': 'someone@example.com'});
    });
  });

  group('signUp', () {
    test('a project that grants a session immediately returns one', () async {
      final h = _harness((r) async => _tokenResponse());

      final session = await h.client.signUp(email: 'new@example.com', password: 'pw');

      expect(session, isNotNull);
      expect(session!.accessToken, 'the-access-token');
    });

    test('a project requiring email confirmation returns null, not an error', () async {
      final h = _harness(
        (r) async => http.Response(
          jsonEncode({'id': 'user-1', 'email': 'new@example.com', 'confirmed_at': null}),
          200,
        ),
      );

      final session = await h.client.signUp(email: 'new@example.com', password: 'pw');

      expect(session, isNull);
    });
  });
}
