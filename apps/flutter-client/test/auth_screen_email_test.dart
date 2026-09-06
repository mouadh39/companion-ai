import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/models/auth_session.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/profile_repository.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';
import 'package:nexa_client/data/repositories/session_store.dart';
import 'package:nexa_client/data/repositories/supabase_auth_client.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/screens/auth_error_text.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Redeclared per file rather than shared, matching the convention already
/// established by `auth_session_repository_test.dart`.
class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// A real [AuthSessionRepository] wired to a mocked HTTP transport, so the
/// screens under test drive real sign-in/sign-up/reset logic with no
/// network and no platform secure-storage channel.
({AuthSessionRepository repo, Future<http.Request> Function() lastRequest})
_repo(Future<http.Response> Function(http.Request) handler) {
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
  final repo = AuthSessionRepository(
    sessionStore: SessionStore(_FakeKeyValueStore()),
    authClient: authClient,
  );
  return (repo: repo, lastRequest: () async => seen!);
}

http.Response _tokenResponse({int expiresIn = 3600, String userId = 'user-1'}) =>
    http.Response(
      jsonEncode({
        'access_token': 'the-access-token',
        'refresh_token': 'the-refresh-token',
        'token_type': 'bearer',
        'expires_in': expiresIn,
        'user': {'id': userId},
      }),
      200,
    );

/// A [ProfileRepository] that always answers `GET /v1/profile` the same
/// way — for the tests in this file that need `routeAfterAuthentication` to
/// resolve to a specific, known outcome without caring about the request
/// itself.
ProfileRepository _profileRepoAnswering({
  required AuthTokenProvider tokenProvider,
  required bool completed,
}) {
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://nexa.example/'),
    httpClient: MockClient(
      (request) async => http.Response(
        jsonEncode({
          'firstName': null,
          'username': null,
          'dateOfBirth': null,
          'completed': completed,
        }),
        200,
      ),
    ),
  );
  return ProfileRepository(tokenProvider: tokenProvider, backend: NexaBackend(api));
}

/// Mounts the real app shell — [NexaApp] itself, not just its screens — with
/// an injected [NexaAppState] so the launch-time restore path runs for real
/// against a fake session store instead of a platform channel.
///
/// [profile] defaults to one reporting onboarding already complete: most
/// tests using this helper are about the auth/restore path itself, not
/// onboarding, and completed is what lets them reach the assistant the way
/// they did before `routeAfterAuthentication` existed.
Future<NexaAppState> _pumpApp(
  WidgetTester tester, {
  required AuthSessionRepository authSession,
  ProfileRepository? profile,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final state = NexaAppState(
    authSession: authSession,
    profile:
        profile ??
        _profileRepoAnswering(tokenProvider: authSession, completed: true),
  );
  addTearDown(state.dispose);

  await tester.pumpWidget(NexaApp(state: state));
  await tester.pump();
  // Past the launch entrance (first-launch is ~2.8s), then let the
  // post-entrance routing — session restore + routeAfterAuthentication's
  // profile check — settle.
  await tester.pump(const Duration(seconds: 3));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 700));
  await tester.pump();
  return state;
}

/// Mounts just the screens, the way `navigation_test.dart`'s own
/// `nexaTestHost` does — for the tests below that drive a screen directly
/// rather than the app's launch sequence. Never `pumpAndSettle` anywhere in
/// this file: `NexaMark` breathes and floats indefinitely on several of
/// these screens, so nothing here ever "settles" — every wait is a bounded
/// `pump(duration)`, exactly as `navigation_test.dart` already does
/// throughout.
Widget _host(NexaAppState state) => NexaScope(
  state: state,
  child: ListenableBuilder(
    listenable: state,
    builder: (context, _) => NexaAppearance(
      palette: NexaPalette.dark,
      reducedMotion: false,
      child: MaterialApp(
        home: DefaultTextStyle(
          style: NexaType.ui(color: NexaPalette.dark.ink),
          child: const NexaHome(),
        ),
      ),
    ),
  ),
);

/// Drag the page up until [finder] has been built — `SecurityScreen`'s
/// sign-in-methods section sits below the fold, in a lazy `ListView`, the
/// same reason `navigation_test.dart` needs the identical helper.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 14 && finder.evaluate().isEmpty; i++) {
    await tester.drag(find.byType(ListView).last, const Offset(0, -260));
    await tester.pump(const Duration(milliseconds: 220));
  }
  await tester.pump(const Duration(milliseconds: 220));
}

Future<NexaAppState> _pumpEmail(
  WidgetTester tester, {
  required AuthSessionRepository authSession,
  required NexaScreen at,
  ProfileRepository? profile,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final state = NexaAppState(authSession: authSession, profile: profile);
  addTearDown(state.dispose);
  state.go(at);
  state.setAuthMode(AuthMode.email);

  await tester.pumpWidget(_host(state));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 700));
  return state;
}

void main() {
  group('sign in', () {
    testWidgets('empty fields are rejected locally — no network call at all', (
      tester,
    ) async {
      final h = _repo((r) => fail('should not be called'));
      await _pumpEmail(tester, authSession: h.repo, at: NexaScreen.login);

      await tester.tap(find.text('Sign in'));
      await tester.pump();

      expect(find.text('Email is required.'), findsOneWidget);
      expect(find.text('Password is required.'), findsOneWidget);
    });

    testWidgets(
      'a malformed address is rejected locally without a network call',
      (tester) async {
        final h = _repo((r) => fail('should not be called'));
        await _pumpEmail(tester, authSession: h.repo, at: NexaScreen.login);

        await tester.enterText(find.byType(TextField).first, 'not-an-email');
        await tester.enterText(find.byType(TextField).at(1), 'a-password');
        await tester.tap(find.text('Sign in'));
        await tester.pump();

        expect(
          find.text("That doesn't look like an email address."),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'shows a loading label while the request is in flight, then signs in, '
      'persists the session, and lands on the assistant',
      (tester) async {
        // Gated so the loading frame is observable deterministically, rather
        // than racing a `MockClient` future that would otherwise resolve
        // before the next pump ever gets a chance to look.
        final gate = Completer<http.Response>();
        final h = _repo((r) => gate.future);
        final state = await _pumpEmail(
          tester,
          authSession: h.repo,
          at: NexaScreen.login,
          // Sign-in success routes through routeAfterAuthentication, which
          // needs a real answer to its own profile check to land on the
          // assistant — "already complete" is what makes that the outcome
          // this test is actually about.
          profile: _profileRepoAnswering(tokenProvider: h.repo, completed: true),
        );

        await tester.enterText(
          find.byType(TextField).first,
          'someone@example.com',
        );
        await tester.enterText(find.byType(TextField).at(1), 'correct-password');
        await tester.tap(find.text('Sign in'));
        await tester.pump();

        expect(find.text('Signing in…'), findsOneWidget);

        gate.complete(_tokenResponse());
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(state.screen, NexaScreen.assistant);
        expect(h.repo.isSignedIn, isTrue);
        expect(h.repo.current!.accessToken, 'the-access-token');
        expect(state.email, 'someone@example.com');

        final request = await h.lastRequest();
        expect(request.url.queryParameters['grant_type'], 'password');
        expect(
          jsonDecode(request.body),
          {'email': 'someone@example.com', 'password': 'correct-password'},
        );
      },
    );

    testWidgets(
      'a rejected password shows an inline error and never navigates',
      (tester) async {
        final h = _repo(
          (r) async => http.Response(
            jsonEncode({'error': 'invalid_grant', 'message': 'Invalid login credentials'}),
            400,
          ),
        );
        final state = await _pumpEmail(
          tester,
          authSession: h.repo,
          at: NexaScreen.login,
        );

        await tester.enterText(
          find.byType(TextField).first,
          'someone@example.com',
        );
        await tester.enterText(find.byType(TextField).at(1), 'wrong-password');
        await tester.tap(find.text('Sign in'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(find.text('Incorrect email or password.'), findsOneWidget);
        expect(state.screen, NexaScreen.login);
        expect(h.repo.isSignedIn, isFalse);
      },
    );

    testWidgets('the password field is obscured by default and can be shown', (
      tester,
    ) async {
      final h = _repo((r) => fail('should not be called'));
      await _pumpEmail(tester, authSession: h.repo, at: NexaScreen.login);

      final passwordField = find.byType(TextField).at(1);
      expect(tester.widget<TextField>(passwordField).obscureText, isTrue);

      await tester.tap(find.text('Show'));
      await tester.pump();
      expect(tester.widget<TextField>(passwordField).obscureText, isFalse);
      expect(find.text('Hide'), findsOneWidget);
    });

    testWidgets('forgot password reaches the reset screen', (tester) async {
      final h = _repo((r) => fail('should not be called'));
      final state = await _pumpEmail(
        tester,
        authSession: h.repo,
        at: NexaScreen.login,
      );

      await tester.tap(find.text('Forgot password?'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));

      expect(state.screen, NexaScreen.forgot);
    });

    testWidgets(
      "'Don't have an account?' switches to the create-account form, staying in email mode",
      (tester) async {
        final h = _repo((r) => fail('should not be called'));
        final state = await _pumpEmail(
          tester,
          authSession: h.repo,
          at: NexaScreen.login,
        );

        await tester.tap(find.text("Don't have an account? Create account"));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(state.screen, NexaScreen.signup);
        expect(state.authMode, AuthMode.email);
        expect(find.text('CONFIRM PASSWORD'), findsOneWidget);
      },
    );
  });

  group('create account', () {
    testWidgets('mismatched passwords are rejected locally', (tester) async {
      final h = _repo((r) => fail('should not be called'));
      await _pumpEmail(tester, authSession: h.repo, at: NexaScreen.signup);

      await tester.enterText(
        find.byType(TextField).first,
        'new@example.com',
      );
      await tester.enterText(find.byType(TextField).at(1), 'password-one');
      await tester.enterText(find.byType(TextField).at(2), 'password-two');
      await tester.tap(find.text('Create account'));
      await tester.pump();

      expect(find.text("Passwords don't match."), findsOneWidget);
    });

    testWidgets(
      'a project granting an immediate session signs up and proceeds to the first meeting',
      (tester) async {
        final h = _repo((r) async => _tokenResponse());
        final state = await _pumpEmail(
          tester,
          authSession: h.repo,
          at: NexaScreen.signup,
        );

        await tester.enterText(
          find.byType(TextField).first,
          'new@example.com',
        );
        await tester.enterText(find.byType(TextField).at(1), 'a-real-password');
        await tester.enterText(find.byType(TextField).at(2), 'a-real-password');
        await tester.tap(find.text('Create account'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(state.screen, NexaScreen.meeting);
        expect(h.repo.isSignedIn, isTrue);
      },
    );

    testWidgets(
      'a project requiring email confirmation shows the notice instead of navigating, with no session created',
      (tester) async {
        final h = _repo(
          (r) async => http.Response(
            jsonEncode({
              'id': 'user-1',
              'email': 'new@example.com',
              'confirmed_at': null,
            }),
            200,
          ),
        );
        final state = await _pumpEmail(
          tester,
          authSession: h.repo,
          at: NexaScreen.signup,
        );

        await tester.enterText(
          find.byType(TextField).first,
          'new@example.com',
        );
        await tester.enterText(find.byType(TextField).at(1), 'a-real-password');
        await tester.enterText(find.byType(TextField).at(2), 'a-real-password');
        await tester.tap(find.text('Create account'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(
          find.textContaining("We've sent a confirmation link"),
          findsOneWidget,
        );
        expect(state.screen, NexaScreen.signup); // did not navigate away
        expect(h.repo.isSignedIn, isFalse);
      },
    );
  });

  group('forgot password', () {
    testWidgets(
      'a real submission shows the same confirmation regardless of outcome',
      (tester) async {
        final h = _repo((r) async => http.Response('', 200));
        final state = NexaAppState(authSession: h.repo);
        addTearDown(state.dispose);
        state.go(NexaScreen.forgot);

        tester.view.physicalSize = const Size(390 * 3, 844 * 3);
        tester.view.devicePixelRatio = 3.0;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(_host(state));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        await tester.enterText(
          find.byType(TextField).first,
          'someone@example.com',
        );
        await tester.tap(find.text('Send reset link'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));

        expect(
          find.textContaining("we've sent a link to reset your password"),
          findsOneWidget,
        );
        final request = await h.lastRequest();
        expect(request.url.path, '/auth/v1/recover');
        expect(jsonDecode(request.body), {'email': 'someone@example.com'});
      },
    );

    testWidgets('an empty email is rejected locally', (tester) async {
      final h = _repo((r) => fail('should not be called'));
      final state = NexaAppState(authSession: h.repo);
      addTearDown(state.dispose);
      state.go(NexaScreen.forgot);

      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_host(state));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));

      await tester.tap(find.text('Send reset link'));
      await tester.pump();

      expect(find.text('Email is required.'), findsOneWidget);
    });
  });

  group('session restoration on launch', () {
    testWidgets('a signed-in session routes past Welcome onto the assistant', (
      tester,
    ) async {
      // Restoring the session itself touches only the local store — the
      // network call that follows is routeAfterAuthentication's own
      // profile check, answered by _pumpApp's default fixture below as
      // "already complete".
      final store = SessionStore(_FakeKeyValueStore());
      await store.write(
        AuthSession(
          accessToken: 'stored-access',
          refreshToken: 'stored-refresh',
          expiresAt: DateTime.now().add(const Duration(hours: 1)),
          userId: 'user-1',
        ),
      );
      final repo = AuthSessionRepository(sessionStore: store);

      final state = await _pumpApp(tester, authSession: repo);

      expect(state.screen, NexaScreen.assistant);
      expect(find.text("Explore what's next."), findsNothing);
    });

    testWidgets(
      'a restored session repopulates the real email — never a placeholder',
      (tester) async {
        final store = SessionStore(_FakeKeyValueStore());
        await store.write(
          AuthSession(
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            expiresAt: DateTime.now().add(const Duration(hours: 1)),
            userId: 'user-1',
            email: 'returning@example.com',
          ),
        );
        final repo = AuthSessionRepository(sessionStore: store);

        final state = await _pumpApp(tester, authSession: repo);

        expect(state.email, 'returning@example.com');
      },
    );

    testWidgets(
      'a stored session with no email leaves the account email untouched, rather than inventing one',
      (tester) async {
        final store = SessionStore(_FakeKeyValueStore());
        await store.write(
          AuthSession(
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            expiresAt: DateTime.now().add(const Duration(hours: 1)),
            userId: 'user-1',
            // No email — an older stored session, or a non-email grant.
          ),
        );
        final repo = AuthSessionRepository(sessionStore: store);

        final state = await _pumpApp(tester, authSession: repo);

        expect(state.screen, NexaScreen.assistant); // still routes correctly
        expect(state.email, ''); // untouched default, not a fabricated one
      },
    );

    testWidgets('no stored session stays on Welcome', (tester) async {
      final repo = AuthSessionRepository(
        sessionStore: SessionStore(_FakeKeyValueStore()),
      );

      final state = await _pumpApp(tester, authSession: repo);

      expect(state.screen, NexaScreen.welcome);
      expect(find.text("Explore what's next."), findsOneWidget);
    });
  });

  group('security screen reflects real sign-in state', () {
    testWidgets(
      'shows email as the one active method once signed in — not the old '
      'hardcoded apple/passkey',
      (tester) async {
        final store = SessionStore(_FakeKeyValueStore());
        await store.write(
          AuthSession(
            accessToken: 'a',
            refreshToken: 'b',
            expiresAt: DateTime.now().add(const Duration(hours: 1)),
            userId: 'user-1',
          ),
        );
        final repo = AuthSessionRepository(sessionStore: store);
        await repo.restore();

        final state = NexaAppState(authSession: repo);
        addTearDown(state.dispose);
        state.go(NexaScreen.security);

        tester.view.physicalSize = const Size(390 * 3, 844 * 3);
        tester.view.devicePixelRatio = 3.0;
        addTearDown(tester.view.reset);
        await tester.pumpWidget(_host(state));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));
        await _reveal(tester, find.text('Email'));

        expect(find.text('Email'), findsOneWidget);
        // "Active" is the badge NexaRow actually renders for a method in
        // `active` (see SecurityScreen — its own `value` string is not the
        // rendered indicator, `trailing` is). Exactly one shows: Apple and
        // Passkey are real rows on this same screen but are no longer
        // falsely marked as in use.
        expect(find.text('Active'), findsOneWidget);
      },
    );

    testWidgets('no sign-in method is active when nobody is signed in', (
      tester,
    ) async {
      final state = NexaAppState(
        authSession: AuthSessionRepository(
          sessionStore: SessionStore(_FakeKeyValueStore()),
        ),
      );
      addTearDown(state.dispose);
      state.go(NexaScreen.security);

      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(_host(state));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      // Reveal the last sign-in-method row, so every row above it — the
      // ones actually under test — has been built too.
      await _reveal(tester, find.text('Passkey'));

      expect(find.text('Active'), findsNothing);
    });
  });

  group('authErrorMessage', () {
    test('maps sign-in vs sign-up invalidRequest differently', () {
      const err = NexaApiException(NexaApiFailureKind.invalidRequest, 'x');
      expect(authErrorMessage(err, isSignUp: false), 'Incorrect email or password.');
      expect(
        authErrorMessage(err, isSignUp: true),
        contains('already exist'),
      );
    });

    test('AuthNotConfiguredException never crashes the caller', () {
      expect(
        authErrorMessage(const AuthNotConfiguredException(), isSignUp: false),
        isNotEmpty,
      );
    });
  });
}
