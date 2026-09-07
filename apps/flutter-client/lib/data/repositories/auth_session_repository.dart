import '../models/api_failure.dart';
import '../models/auth_session.dart';
import 'session_store.dart';
import 'supabase_auth_client.dart';

/// What anything that must call an authenticated Nexa endpoint needs: the
/// live access token to send, or `null` if there is none.
///
/// [NexaApiClient]/[NexaBackend] never implement or depend on this — they
/// only ever take a bearer token as a plain `String` argument, from
/// whichever caller already resolved one. This is the seam on the other
/// side of that boundary: what a caller resolves it *from*. Keeping the two
/// apart is what lets the API layer stay ignorant of Supabase, sessions, or
/// storage entirely.
abstract interface class AuthTokenProvider {
  /// A currently-valid access token, refreshing first if the held one is
  /// expired or close to it. `null` means there is no session to present —
  /// a caller should treat that exactly like a 401 it already knows how to
  /// handle, not as a separate error path.
  Future<String?> validAccessToken();
}

/// What `PhoneDeviceRepository` needs beyond a bearer token: whose account
/// it would be registering a device *for*.
///
/// Kept apart from [AuthTokenProvider] rather than folded into it — a
/// caller that only ever needs to authenticate a request (the original,
/// narrower boundary [AuthTokenProvider] exists for) should not be forced
/// to also depend on knowing who is signed in.
abstract interface class AuthenticatedIdentityProvider {
  /// The signed-in account's id right now, or `null` if nobody is. This is
  /// what lets a caller tell "the same account that registered a stored
  /// device is still the one signed in" from "someone else is now" —
  /// something no backend response can answer, since a device id alone
  /// carries no such claim.
  String? get currentUserId;
}

/// Raised when whatever is calling requires a signed-in user and there
/// isn't one right now. Shared across every repository that needs an
/// account to act on behalf of — `PhoneDeviceRepository.ensureRegistered`,
/// `PairingSessionRepository.createPairingSession` — for the same reason
/// `classifyJwtError` is shared on the backend rather than reimplemented
/// per verifier: one definition of "not signed in" cannot drift from
/// itself.
class NotAuthenticatedException implements Exception {
  const NotAuthenticatedException();

  @override
  String toString() =>
      'NotAuthenticatedException: no signed-in user for this to act on behalf of.';
}

/// Raised when Supabase authentication has not been configured for this
/// build — no project URL, no anon key. Distinguished from a normal
/// [NexaApiException] because it is not a runtime failure of a real call;
/// it means nobody has yet supplied the one thing this class cannot invent.
class AuthNotConfiguredException implements Exception {
  const AuthNotConfiguredException();

  @override
  String toString() =>
      'AuthNotConfiguredException: no SupabaseAuthConfig was supplied.';
}

/// Owns this phone's one Supabase session: holding it in memory, persisting
/// it securely, restoring it at startup, refreshing it transparently, and
/// dropping it on sign-out.
///
/// This is the "authenticated session provider" between `NexaAppState` and
/// the API layer. It is deliberately the only class in this app that ever
/// reads or writes a session — `NexaAppState` holds a reference to it and
/// exposes what a screen needs (see `NexaAppState.authSession`), but never
/// touches [SessionStore] or [SupabaseAuthClient] itself.
///
/// Constructed with `config: null` when no Supabase project has been
/// configured for this build (true of every build in this repository right
/// now — see the accompanying report). Every method that would need a real
/// network call throws [AuthNotConfiguredException] in that case, loudly
/// and immediately, rather than silently doing nothing or fabricating a
/// session — see the module doc on why a fake success is never acceptable
/// here.
class AuthSessionRepository
    implements AuthTokenProvider, AuthenticatedIdentityProvider {
  AuthSessionRepository({
    required SessionStore sessionStore,
    SupabaseAuthConfig? config,
    SupabaseAuthClient? authClient,
  }) : _store = sessionStore,
       _auth = authClient ?? (config == null ? null : SupabaseAuthClient(config));

  final SessionStore _store;
  final SupabaseAuthClient? _auth;

  AuthSession? _current;

  /// The session held in memory right now, if any. `null` both before
  /// [restore] has run and after [logout].
  AuthSession? get current => _current;

  bool get isSignedIn => _current != null;

  @override
  String? get currentUserId => _current?.userId;

  SupabaseAuthClient _requireAuth() {
    final auth = _auth;
    if (auth == null) throw const AuthNotConfiguredException();
    return auth;
  }

  /// Loads whatever session was persisted from a previous run into memory.
  ///
  /// Call once, at startup, before anything reads [current]. Deliberately
  /// does not refresh eagerly — [validAccessToken] refreshes lazily,
  /// exactly once, whenever something actually needs a token, so a restore
  /// that nothing ends up using costs nothing.
  Future<void> restore() async {
    _current = await _store.read();
  }

  Future<void> signInWithPassword({
    required String email,
    required String password,
  }) async {
    final session = await _requireAuth().signInWithPassword(
      email: email,
      password: password,
    );
    _current = session;
    await _store.write(session);
  }

  /// Returns the new session, or `null` when the project requires email
  /// confirmation before one exists yet — see [SupabaseAuthClient.signUp].
  Future<AuthSession?> signUp({
    required String email,
    required String password,
  }) async {
    final session = await _requireAuth().signUp(
      email: email,
      password: password,
    );
    if (session != null) {
      _current = session;
      await _store.write(session);
    }
    return session;
  }

  Future<void> requestPasswordReset(String email) =>
      _requireAuth().requestPasswordReset(email);

  /// Signs out of this device: clears the session in memory, clears it from
  /// secure storage, and best-effort invalidates it on Supabase's side.
  ///
  /// Safe to call with no session held — `NexaAppState.logOut()` always
  /// calls this, whether or not anyone ever signed in.
  Future<void> logout() async {
    final session = _current;
    _current = null;
    await _store.clear();
    if (session != null && _auth != null) {
      await _auth.signOut(session.accessToken);
    }
  }

  @override
  Future<String?> validAccessToken() async {
    final session = _current;
    if (session == null) return null;
    if (!session.isExpired()) return session.accessToken;

    // Not configured is not "the refresh token is dead" — it means nobody
    // can attempt the refresh at all, which deserves to surface loudly
    // rather than be mistaken for an expired session. See the module doc.
    final auth = _requireAuth();

    // The held token is expired or close to it — spend the refresh token
    // once, exactly the way `PgDeviceTokenStore.refresh` treats a Nexa
    // device refresh token: a single live credential, rotated on use, with
    // whatever came before it no longer good for anything.
    try {
      final refreshed = await auth.refreshSession(session.refreshToken);
      _current = refreshed;
      await _store.write(refreshed);
      return refreshed.accessToken;
    } on NexaApiException {
      // The refresh token itself is dead — expired, revoked, or already
      // spent. There is no better recovery than asking to sign in again,
      // so the session is dropped rather than left around half-valid.
      _current = null;
      await _store.clear();
      return null;
    }
  }
}
