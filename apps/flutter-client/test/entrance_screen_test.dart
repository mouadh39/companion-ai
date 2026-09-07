import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/models/auth_session.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';
import 'package:nexa_client/data/repositories/session_store.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/screens/entrance_screen.dart';
import 'package:nexa_client/screens/welcome_screen.dart';

/// An in-memory [SecureKeyValueStore], so a launch test never touches a
/// platform channel that `flutter test` cannot run.
class _FakeStore implements SecureKeyValueStore {
  final _values = <String, String>{};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
  @override
  Future<void> delete(String key) async => _values.remove(key);
}

Future<NexaAppState> _launch(
  WidgetTester tester, {
  AuthSession? storedSession,
  bool reducedMotion = false,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final store = SessionStore(_FakeStore());
  if (storedSession != null) await store.write(storedSession);

  final state = NexaAppState(
    authSession: AuthSessionRepository(sessionStore: store),
  );
  addTearDown(state.dispose);
  if (reducedMotion) {
    state.updatePrefs(state.prefs.copyWith(reducedMotion: true));
  }

  await tester.pumpWidget(NexaApp(state: state));
  await tester.pump();
  return state;
}

void main() {
  testWidgets('the launch shows the entrance, then hands off to Welcome for a '
      'visitor with no session', (tester) async {
    final state = await _launch(tester);

    // The entrance is what is on screen first — not Welcome.
    expect(find.byType(EntranceScreen), findsOneWidget);
    expect(find.byType(WelcomeScreen), findsNothing);
    expect(state.screen, NexaScreen.entrance);

    // Past the first-launch entrance (~2.8s), it hands off.
    await tester.pump(const Duration(seconds: 3));
    await tester.pump();

    expect(state.entranceComplete, isTrue);
    expect(state.screen, NexaScreen.welcome);
    expect(find.byType(WelcomeScreen), findsOneWidget);
  });

  testWidgets('reduced motion still runs the entrance and still hands off',
      (tester) async {
    final state = await _launch(tester, reducedMotion: true);

    expect(find.byType(EntranceScreen), findsOneWidget);

    // The reduced-motion entrance is short (~0.8s).
    await tester.pump(const Duration(milliseconds: 1200));
    await tester.pump();

    expect(state.screen, NexaScreen.welcome);
  });

  testWidgets('a recognised account is routed by the real post-auth logic, '
      'not dropped on Welcome', (tester) async {
    // A stored session that will fail its profile check (no backend
    // configured) must route to the real error state — never be mistaken
    // for a fresh visitor and sent to Welcome.
    final state = await _launch(
      tester,
      storedSession: AuthSession(
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: DateTime.now().add(const Duration(hours: 1)),
        userId: 'user-1',
      ),
    );

    await tester.pump(const Duration(seconds: 2));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump();

    expect(state.entranceComplete, isTrue);
    expect(state.screen, isNot(NexaScreen.welcome));
    expect(state.screen, NexaScreen.error);
  });

  testWidgets('skipEntrance seam starts on Welcome with the launch already done',
      (tester) async {
    final state = NexaAppState(skipEntrance: true);
    addTearDown(state.dispose);
    expect(state.screen, NexaScreen.welcome);
    expect(state.entranceComplete, isTrue);
  });
}
