import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Walks the slice the way a person would, so a regression in any one screen
/// fails here rather than on a device.
void main() {
  testWidgets('welcome to assistant, by way of sign up and first meeting', (
    tester,
  ) async {
    // A phone-sized surface, so the frame stays off and SafeArea behaves.
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(const NexaApp());
    await tester.pump(const Duration(seconds: 1));

    // Welcome.
    expect(find.text("Explore what's next."), findsOneWidget);
    expect(find.text('A new kind of AI companion.'), findsOneWidget);

    await tester.tap(find.text('Get started'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Sign up, on the provider list.
    expect(find.text('Welcome to Nexa'), findsOneWidget);
    expect(find.text('Continue with Google'), findsOneWidget);
    expect(find.text('Use a passkey'), findsOneWidget);

    await tester.tap(find.text('Continue with Apple'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // First meeting, beat one of three.
    expect(find.text("I'm Nexa."), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('I keep what matters.'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Who are you?'), findsOneWidget);

    // The name is read back in the call to action.
    await tester.enterText(find.byType(TextField), 'Mouadh');
    await tester.pump();
    expect(find.text('Nice to meet you, Mouadh'), findsOneWidget);

    await tester.tap(find.text('Nice to meet you, Mouadh'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    // Assistant, idle, greeting the name we gave.
    expect(find.text('Nexa is here'), findsOneWidget);
    expect(find.text('HELLO, MOUADH'), findsOneWidget);
    // The tab bar appears here and nowhere earlier.
    expect(find.text('Memory'), findsOneWidget);
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

  testWidgets('auth swaps between its four modes on one surface', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final state = NexaAppState();
    addTearDown(state.dispose);
    state.go(NexaScreen.login);

    await tester.pumpWidget(
      nexaTestHost(state),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Welcome back.'), findsOneWidget);

    await tester.tap(find.text('Continue with phone'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('What is your number?'), findsOneWidget);
    expect(find.text('+1'), findsOneWidget);

    state.setAuthMode(AuthMode.passkey);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Use your passkey.'), findsOneWidget);
    expect(find.text('Confirm with your device'), findsOneWidget);

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
