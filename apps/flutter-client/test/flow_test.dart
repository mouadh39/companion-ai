import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/profile_repository.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';
import 'package:nexa_client/data/repositories/session_store.dart';
import 'package:nexa_client/data/repositories/supabase_auth_client.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Walks the slice the way a person would, so a regression in any one screen
/// fails here rather than on a device.
///
/// The first test walks all the way through real sign-up and real
/// onboarding — every step here now calls a real repository, so it needs a
/// mocked backend behind it, the same way `auth_screen_email_test.dart`'s
/// own tests do. "Continue with Apple" is still the unimplemented
/// placeholder it always was and cannot complete a real session, so this
/// walks the one identity path that is real: email and password.
class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// This run's saved profile fields, mutated by whatever the flow PATCHes —
/// a small real fake rather than a fixed canned response, so the flow can
/// actually resume/complete across several calls the way the real backend
/// would.
class _ProfileState {
  String? firstName;
  String? username;
  String? dateOfBirth;

  bool get completed => firstName != null && username != null && dateOfBirth != null;

  Map<String, dynamic> toJson() => {
    'firstName': firstName,
    'username': username,
    'dateOfBirth': dateOfBirth,
    'completed': completed,
  };
}

void main() {
  testWidgets('welcome to assistant, by way of sign up and onboarding', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final profile = _ProfileState();
    final api = NexaApiClient(
      baseUrl: Uri.parse('https://project-ref.supabase.co/'),
      httpClient: MockClient((request) async {
        if (request.url.path == '/auth/v1/signup') {
          return http.Response(
            jsonEncode({
              'access_token': 'the-access-token',
              'refresh_token': 'the-refresh-token',
              'token_type': 'bearer',
              'expires_in': 3600,
              'user': {'id': 'user-1', 'email': 'mouadh@example.com'},
            }),
            200,
          );
        }
        if (request.method == 'GET' && request.url.path == '/v1/profile') {
          return http.Response(jsonEncode(profile.toJson()), 200);
        }
        if (request.method == 'PATCH' && request.url.path == '/v1/profile') {
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          if (body.containsKey('firstName')) profile.firstName = body['firstName'] as String;
          if (body.containsKey('username')) profile.username = body['username'] as String;
          if (body.containsKey('dateOfBirth')) {
            profile.dateOfBirth = body['dateOfBirth'] as String;
          }
          return http.Response(jsonEncode(profile.toJson()), 200);
        }
        return http.Response('not found', 404);
      }),
    );

    final authSession = AuthSessionRepository(
      sessionStore: SessionStore(_FakeKeyValueStore()),
      authClient: SupabaseAuthClient(
        SupabaseAuthConfig(
          projectUrl: Uri.parse('https://project-ref.supabase.co/'),
          anonKey: 'anon-key',
        ),
        apiClient: api,
      ),
    );
    final profileRepository = ProfileRepository(
      tokenProvider: authSession,
      backend: NexaBackend(api),
    );
    final state = NexaAppState(authSession: authSession, profile: profileRepository);
    addTearDown(state.dispose);

    await tester.pumpWidget(NexaApp(state: state));
    // Past the launch entrance (~2.8s first launch) and into Welcome.
    await tester.pump();
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();

    // Welcome.
    expect(find.text("Explore what's next."), findsOneWidget);
    expect(find.text('A new kind of AI companion.'), findsOneWidget);

    await tester.tap(find.text('Get started'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Sign up: providers on top, the real email form below.
    expect(find.text('Welcome to Nexa'), findsOneWidget);
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.text('Continue with a passkey'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'mouadh@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'a-real-password');
    await tester.enterText(find.byType(TextField).at(2), 'a-real-password');
    // The submit button sits below the providers + form on the scrolling
    // auth surface.
    await tester.ensureVisible(find.text('Create account'));
    await tester.pump();
    await tester.tap(find.text('Create account'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // First meeting, the welcome beat.
    expect(find.text('Hey. I\'m Nexa.'), findsOneWidget);

    await tester.tap(find.text("Let's get started"));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text("What's your name?"), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'Mouadh');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Username.
    expect(find.text('What should I call you?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'mouadh_9');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Date of birth.
    expect(find.text("When's your birthday?"), findsOneWidget);
    final dobFields = find.byType(TextField);
    await tester.enterText(dobFields.at(0), '1');
    await tester.enterText(dobFields.at(1), '1');
    await tester.enterText(dobFields.at(2), '1990');
    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Confirmation.
    expect(find.text("You're all set."), findsOneWidget);
    await tester.tap(find.text('Enter Nexa'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Assistant, idle, greeting the name we gave.
    expect(find.text('Nexa is here'), findsOneWidget);
    expect(find.text('HELLO, MOUADH'), findsOneWidget);
    // The tab bar appears here and nowhere earlier.
    expect(find.text('Memory'), findsOneWidget);

    expect(profile.completed, isTrue);
  });

  testWidgets('a turn moves the mark through listening and speaking', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final state = NexaAppState();
    addTearDown(state.dispose);
    state.go(NexaScreen.assistant);

    await tester.pumpWidget(
      nexaTestHost(state),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Nexa is here'), findsOneWidget);

    state.talk();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('Go ahead'), findsOneWidget);
    expect(find.text('YOU'), findsOneWidget);

    // Listening runs 2.6s, then Nexa answers.
    await tester.pump(const Duration(milliseconds: 2600));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Speaking'), findsOneWidget);
    // The header greeting and the transcript's attribution both read NEXA
    // while she is the one talking.
    expect(find.text('NEXA'), findsNWidgets(2));

    // …and settles back to idle 5.2s later.
    await tester.pump(const Duration(milliseconds: 5200));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Nexa is here'), findsOneWidget);
  });

  testWidgets('auth shows providers honestly and the real email form on one '
      'surface', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final state = NexaAppState(skipEntrance: true);
    addTearDown(state.dispose);
    state.go(NexaScreen.login);

    await tester.pumpWidget(nexaTestHost(state));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Welcome back.'), findsOneWidget);

    // All four providers are drawn, and the email form is right there too.
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.text('Continue with Apple'), findsOneWidget);
    expect(find.text('Continue with Meta'), findsOneWidget);
    expect(find.text('Continue with a passkey'), findsOneWidget);
    expect(find.text('OR USE EMAIL'), findsOneWidget);
    expect(find.text('EMAIL'), findsOneWidget);
    expect(find.text('PASSWORD'), findsOneWidget);

    // Tapping a provider is honest — it says so, it does not navigate.
    await tester.tap(find.text('Continue with Google'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(state.screen, NexaScreen.login);
    expect(find.textContaining("isn’t connected yet"), findsOneWidget);

    // Forgot password is still one tap away.
    state.go(NexaScreen.forgot);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Reset your access.'), findsOneWidget);
    expect(find.text('Send reset link'), findsOneWidget);
  });
}

/// Mounts the app's screens with an appearance above them, the way the real
/// root does. Tests that drive a specific screen use this instead of
/// [NexaApp], which owns its own state.
Widget nexaTestHost(NexaAppState state, {NexaPalette? palette}) {
  return NexaScope(
    state: state,
    child: ListenableBuilder(
      listenable: state,
      builder: (context, _) => NexaAppearance(
        palette: palette ?? NexaPalette.dark,
        reducedMotion: false,
        child: MaterialApp(
          home: DefaultTextStyle(
            style: NexaType.ui(color: (palette ?? NexaPalette.dark).ink),
            child: const NexaHome(),
          ),
        ),
      ),
    ),
  );
}