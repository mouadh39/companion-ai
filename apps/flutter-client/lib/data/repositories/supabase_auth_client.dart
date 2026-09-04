import '../models/api_failure.dart';
import '../models/auth_session.dart';
import 'nexa_api_client.dart';

/// Which Supabase project this app authenticates against, and the one key
/// it is allowed to hold.
///
/// [anonKey] is the project's anon/publishable key — safe in a shipped
/// client by Supabase's own design; it authorizes a request to GoTrue but
/// grants no capability by itself, and every project ships one baked into
/// every official client the same way. It is never the service-role key
/// and never `SUPABASE_JWT_SECRET`, the backend's own verification secret
/// (`apps/backend/src/auth/supabase.ts`) — neither of those may ever exist
/// in this app, on this device, or in this repository's client code.
class SupabaseAuthConfig {
  const SupabaseAuthConfig({required this.projectUrl, required this.anonKey});

  /// The project's base URL, e.g. `https://xyzcompany.supabase.co`.
  final Uri projectUrl;

  final String anonKey;
}

/// Talks to Supabase's own Auth service (GoTrue) directly over its
/// documented REST API, rather than through the `supabase_flutter` SDK.
///
/// This app uses Supabase for exactly one thing — minting the same kind of
/// access token `SupabaseAuthenticator` already verifies server-side — and
/// never queries Postgres or storage through Supabase's client libraries;
/// every other read and write in this app goes through the Nexa backend's
/// own REST API. Pulling in `supabase_flutter` for three HTTP calls would
/// mean a websocket client, a Postgrest query builder and a storage client
/// this app has no use for, all to reach three endpoints
/// [NexaApiClient] — already built for [NexaBackend] — can call just as
/// well by pointing it at a different base URL and adding one header.
///
/// Nothing here changes what the backend accepts. `/auth/v1/token` is
/// Supabase's own endpoint, unaffected by anything in this repository; the
/// token it returns verifies against `SupabaseAuthenticator` exactly as a
/// token from the official SDK would, because it is the same token.
class SupabaseAuthClient {
  SupabaseAuthClient(this._config, {NexaApiClient? apiClient})
    : _client = apiClient ?? NexaApiClient(baseUrl: _config.projectUrl);

  final SupabaseAuthConfig _config;
  final NexaApiClient _client;

  Map<String, String> get _apiKeyHeader => {'apikey': _config.anonKey};

  /// Exchanges an email and password for a session, via
  /// `POST /auth/v1/token?grant_type=password`.
  ///
  /// The one sign-in method Supabase's Auth service supports with no
  /// further project configuration — no OAuth app registration, no SMS
  /// provider. See `AuthSessionRepository` and the accompanying report for
  /// why this app's current UI has no field this can be wired to yet.
  Future<AuthSession> signInWithPassword({
    required String email,
    required String password,
  }) => _tokenCall('/auth/v1/token?grant_type=password', {
    'email': email,
    'password': password,
  });

  /// Registers a new account, via `POST /auth/v1/signup`.
  ///
  /// A project with email confirmation enabled (Supabase's default) returns
  /// a user with no session yet — [AuthSessionRepository] treats that as
  /// "not signed in," not as a failure, since nothing went wrong.
  Future<AuthSession?> signUp({
    required String email,
    required String password,
  }) async {
    final json = await _client.postJson(
      '/auth/v1/signup',
      body: {'email': email, 'password': password},
      extraHeaders: _apiKeyHeader,
    );
    final session = json['access_token'] == null ? null : json;
    return session == null ? null : _sessionFromToken(session);
  }

  /// Rotates a still-live refresh token for a fresh session, via
  /// `POST /auth/v1/token?grant_type=refresh_token` — Supabase's own
  /// refresh flow, the counterpart to the Nexa backend's device-token
  /// refresh but for the phone's own account session, not a headset's.
  Future<AuthSession> refreshSession(String refreshToken) => _tokenCall(
    '/auth/v1/token?grant_type=refresh_token',
    {'refresh_token': refreshToken},
  );

  /// Invalidates [accessToken] server-side, via `POST /auth/v1/logout`.
  ///
  /// Best-effort: a network failure here is swallowed rather than thrown,
  /// because [AuthSessionRepository.logout] clears the local session
  /// unconditionally, and a person choosing to sign out of this device must
  /// never be blocked by that device's connectivity.
  Future<void> signOut(String accessToken) async {
    try {
      await _client.postJson(
        '/auth/v1/logout',
        body: const {},
        bearerToken: accessToken,
        extraHeaders: _apiKeyHeader,
      );
    } on NexaApiException {
      // See the doc comment above: intentionally not rethrown.
    }
  }

  /// Requests a password-reset email, via `POST /auth/v1/recover`.
  ///
  /// Exists because the existing "forgot password" screen already collects
  /// exactly the one field this needs — see the report on why it is not
  /// wired to this call yet regardless.
  Future<void> requestPasswordReset(String email) async {
    await _client.postJson(
      '/auth/v1/recover',
      body: {'email': email},
      extraHeaders: _apiKeyHeader,
    );
  }

  Future<AuthSession> _tokenCall(
    String path,
    Map<String, dynamic> body,
  ) async {
    final json = await _client.postJson(
      path,
      body: body,
      extraHeaders: _apiKeyHeader,
    );
    return _sessionFromToken(json);
  }

  AuthSession _sessionFromToken(Map<String, dynamic> json) {
    final accessToken = json['access_token'];
    final refreshToken = json['refresh_token'];
    final expiresIn = json['expires_in'];
    final user = json['user'];
    if (accessToken is! String ||
        refreshToken is! String ||
        expiresIn is! int ||
        user is! Map<String, dynamic> ||
        user['id'] is! String) {
      throw const NexaApiException(
        NexaApiFailureKind.decodeFailed,
        'Nexa sent a response this app did not expect.',
      );
    }
    return AuthSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: DateTime.now().add(Duration(seconds: expiresIn)),
      userId: user['id'] as String,
    );
  }
}
