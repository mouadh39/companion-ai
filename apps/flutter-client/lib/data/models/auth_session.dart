/// A live Supabase session — this phone's own proof of identity when it
/// calls an authenticated Nexa endpoint (`POST /v1/devices`,
/// `POST /v1/pairing-sessions`).
///
/// Fields mirror what Supabase's `/auth/v1/token` response carries (see
/// `SupabaseAuthClient`), mapped onto this app's own camelCase — the shape
/// has not changed, only the casing convention.
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    required this.userId,
  });

  factory AuthSession.fromJson(Map<String, dynamic> json) => AuthSession(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    expiresAt: DateTime.parse(json['expiresAt'] as String),
    userId: json['userId'] as String,
  );

  /// The Supabase-issued access JWT — exactly what `NexaBackend` sends as
  /// `Authorization: Bearer <token>` to an authenticated route. Never put
  /// in a QR payload, never logged, never written anywhere but
  /// [SessionStore].
  final String accessToken;

  /// Single-use once rotated, the same way a Nexa device refresh token is —
  /// see [AuthSessionRepository.validAccessToken] for where this gets
  /// spent. Same handling rules as [accessToken].
  final String refreshToken;

  final DateTime expiresAt;

  /// The Supabase user id — `sub` in the access token the backend verifies.
  /// Carried here only for a UI that wants to know who is signed in; it is
  /// never sent as a request field anywhere, the same way the backend never
  /// trusts a `userId` a caller supplies.
  final String userId;

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'expiresAt': expiresAt.toIso8601String(),
    'userId': userId,
  };

  /// Whether this access token is already expired, or expires within
  /// [skew] — the margin every client of a short-lived JWT needs so a call
  /// already in flight does not straddle the boundary.
  bool isExpired({Duration skew = const Duration(seconds: 30)}) =>
      DateTime.now().isAfter(expiresAt.subtract(skew));

  /// Deliberately never includes either token. This is what a debugger, a
  /// log line, or an accidental `print` sees instead of a live credential.
  @override
  String toString() =>
      'AuthSession(userId: $userId, expiresAt: $expiresAt, '
      'accessToken: <redacted>, refreshToken: <redacted>)';
}
