@Tags(['golden'])
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Renders each core screen at a phone size, in Light and Dark, straight from
/// the app's real widgets — the "screenshots from the real Flutter app" the
/// design handoff asks for, as deterministic golden files.
///
/// Run / refresh with:
///   flutter test --update-goldens test/golden/screens_golden_test.dart
///
/// Text renders in the test's fallback font, not Satoshi/Manrope, so these
/// verify composition, spacing, hierarchy, materials and Light/Dark parity —
/// not the exact glyph shapes. Compare against the authoritative DesignSync
/// frames in the same terms.
Widget _host(NexaAppState state, NexaPalette palette) {
  return NexaScope(
    state: state,
    child: ListenableBuilder(
      listenable: state,
      builder: (context, _) => NexaAppearance(
        palette: palette,
        reducedMotion: true, // still frames; the mark keeps its shape + light
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          home: DefaultTextStyle(
            style: NexaType.ui(color: palette.ink),
            child: NexaAppearance(
              palette: palette,
              reducedMotion: true,
              child: const NexaHome(),
            ),
          ),
        ),
      ),
    ),
  );
}

Future<void> _shot(
  WidgetTester tester,
  String name,
  NexaScreen screen, {
  NexaPalette? palette,
  void Function(NexaAppState)? setup,
}) async {
  final p = palette ?? NexaPalette.dark;
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  final state = NexaAppState(skipEntrance: true);
  addTearDown(state.dispose);
  setup?.call(state);
  state.go(screen);

  await tester.pumpWidget(_host(state, p));
  await tester.pump(const Duration(milliseconds: 600));
  await tester.pump(const Duration(milliseconds: 600));

  await expectLater(
    find.byType(NexaHome),
    matchesGoldenFile('goldens/$name.png'),
  );
}

void main() {
  final screens = <(String, NexaScreen)>[
    ('welcome', NexaScreen.welcome),
    ('signin', NexaScreen.login),
    ('signup', NexaScreen.signup),
    ('forgot', NexaScreen.forgot),
    ('assistant', NexaScreen.assistant),
    ('memory-empty', NexaScreen.memory),
    ('devices-empty', NexaScreen.devices),
    ('account', NexaScreen.profile),
    ('settings', NexaScreen.settings),
    ('appearance', NexaScreen.settingsAppearance),
  ];

  for (final (name, screen) in screens) {
    testWidgets('$name — dark', (t) async {
      await _shot(t, '$name-dark', screen, palette: NexaPalette.dark);
    });
    testWidgets('$name — light', (t) async {
      await _shot(t, '$name-light', screen, palette: NexaPalette.light);
    });
  }
}
