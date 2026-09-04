import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/models/device.dart';
import 'package:nexa_client/data/repositories/device_repository.dart';
import 'package:nexa_client/data/repositories/pairing.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/widgets/nexa_controls.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Mounts the app at a phone size with the given state.
Future<NexaAppState> _pump(WidgetTester tester, {NexaScreen? at}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  final state = NexaAppState();
  addTearDown(state.dispose);
  if (at != null) state.go(at);

  await tester.pumpWidget(
    nexaTestHost(state),
  );
  await tester.pump(const Duration(seconds: 1));
  return state;
}

/// Drag the page up until [finder] has been built, so assertions can reach
/// items a lazy list has not reached yet.
Future<void> _reveal(WidgetTester tester, Finder finder) async {
  for (var i = 0; i < 14 && finder.evaluate().isEmpty; i++) {
    await tester.drag(find.byType(ListView).last, const Offset(0, -260));
    await tester.pump(const Duration(milliseconds: 220));
  }
  await tester.pump(const Duration(milliseconds: 220));
}

void main() {
  testWidgets('every screen renders without throwing', (tester) async {
    final state = await _pump(tester);

    for (final screen in NexaScreen.values) {
      // Detail screens need a subject; give them one so they render the real
      // thing rather than their missing-subject fallback.
      if (screen == NexaScreen.deviceDetail ||
          screen == NexaScreen.pairIntro) {
        state.openDevice('quest3s');
      }
      if (screen == NexaScreen.memoryDetail) state.openMemory('m1');

      state.go(screen);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));

      expect(
        tester.takeException(),
        isNull,
        reason: 'screen ${screen.name} threw while building',
      );
    }
  });

  testWidgets('the four tabs are all reachable and none are inert', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.assistant);

    expect(find.text('Nexa is here'), findsOneWidget);

    await tester.tap(find.text('Memory'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(state.screen, NexaScreen.memory);
    expect(find.text('What Nexa keeps about you.'), findsOneWidget);

    await tester.tap(find.text('Devices'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(state.screen, NexaScreen.devices);
    expect(find.text('The devices Nexa can be present on.'), findsOneWidget);

    await tester.tap(find.text('You'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(state.screen, NexaScreen.profile);
    expect(find.text('You'), findsWidgets);

    await tester.tap(find.text('Nexa').last);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(state.screen, NexaScreen.assistant);
  });

  testWidgets('every device in the catalogue has its own detail page', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.devices);
    final devices = state.deviceRepository.all();
    expect(devices, isNotEmpty);

    for (final d in devices) {
      state.openDevice(d.id);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));

      expect(tester.takeException(), isNull, reason: 'device ${d.id} threw');
      // The page is driven off the model, so its own name and capabilities
      // are what should be on screen.
      expect(find.text(d.name), findsWidgets, reason: 'no name for ${d.id}');
      expect(
        find.text(d.capabilities.first.label),
        findsWidgets,
        reason: 'no capability table for ${d.id}',
      );
    }
  });

  testWidgets('pairing runs from device to paired, phone showing the code', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.devices);
    expect(state.pairingPhase, PairingPhase.idle);

    // The hub shows only what the account owns; the catalogue is a tap away.
    expect(find.text('YOUR DEVICES'), findsOneWidget);
    expect(find.text('Meta Quest 3S'), findsNothing);

    await tester.tap(find.text('Add device'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.connect);
    expect(find.text('Choose where Nexa should live next.'), findsOneWidget);
    expect(find.text('Meta Quest 3S'), findsOneWidget);

    // Quest 3S is available, so it offers the guided flow.
    state.openDevice('quest3s');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Pair device'), findsWidgets);

    state.startPairing('quest3s');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.pairIntro);
    expect(find.text('Show me how'), findsOneWidget);

    await tester.tap(find.text('Show me how'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.pairing);
    expect(find.text('Put on your headset.'), findsOneWidget);

    await tester.tap(find.text('Next'));
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Open Nexa on your headset.'), findsOneWidget);

    // Stage three is the local link: the phone finds the headset and
    // connects before there is anything worth showing it.
    await tester.tap(find.text('Next'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.text('Connect your headset.'), findsOneWidget);
    expect(state.pairingPhase, PairingPhase.discovering);
    expect(find.textContaining('Looking for'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 1500));
    expect(state.pairingPhase, PairingPhase.deviceFound);
    expect(find.textContaining('Meta Quest 3S found'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 900));
    expect(state.pairingPhase, PairingPhase.connecting);

    await tester.pump(const Duration(milliseconds: 1300));
    expect(state.pairingPhase, PairingPhase.connected);
    expect(find.textContaining('Connected to'), findsOneWidget);

    await tester.tap(find.text('Next'));
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Complete pairing with your headset.'), findsOneWidget);

    await tester.tap(find.text('Show the code'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(state.screen, NexaScreen.pairingCode);
    expect(state.pairingPhase, PairingPhase.issuing);
    expect(find.text('Preparing secure pairing…'), findsOneWidget);

    // The phone puts the code on its own screen and the headset's camera
    // reads it. Nothing here asks the phone to look at anything.
    await tester.pump(const Duration(milliseconds: 900));
    expect(state.pairingPhase, PairingPhase.showing);
    expect(find.text('Complete pairing'), findsOneWidget);
    expect(
      find.text('Look at this code with your headset.'),
      findsOneWidget,
    );
    expect(find.text('META QUEST 3S'), findsOneWidget);
    expect(find.textContaining('Look at this code with Meta Quest 3S'),
        findsOneWidget);

    await tester.pump(const Duration(milliseconds: 2600));
    expect(state.pairingPhase, PairingPhase.headsetReading);
    expect(
      find.text('Your headset has read the code. Hold on…'),
      findsOneWidget,
    );

    await tester.pump(const Duration(milliseconds: 1700));
    await tester.pump(const Duration(milliseconds: 900));
    expect(state.screen, NexaScreen.success);
    expect(state.pairingPhase, PairingPhase.paired);
    expect(find.text('PAIRING COMPLETE'), findsOneWidget);

    // And the device is now on the account.
    expect(
      state.deviceRepository.byId('quest3s')!.status,
      DeviceStatus.connected,
    );
  });

  testWidgets('no pairing copy asks the phone to do the scanning', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.devices);
    state.startPairing('quest3s');
    state.beginGuide();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    // The direction is fixed: the phone displays, the headset reads. Any
    // wording that reverses it is a bug, not a rewrite.
    const wrong = [
      'Scan it with this phone',
      'Point your phone at the code',
      'Scan the QR code with your phone',
      'Open the scanner',
    ];

    for (var step = 0; step < 4; step++) {
      state.setPairStep(step);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 4200));
      for (final phrase in wrong) {
        expect(
          find.textContaining(phrase),
          findsNothing,
          reason: 'guide step ${step + 1} reverses the pairing direction',
        );
      }
    }

    state.go(NexaScreen.pairingCode);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 1200));
    for (final phrase in wrong) {
      expect(find.textContaining(phrase), findsNothing);
    }
    // Let the scripted pairing finish so no timer outlives the test.
    await tester.pump(const Duration(milliseconds: 5200));
  });

  testWidgets('the hub separates owned devices from the catalogue', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.devices);
    final mine = state.deviceRepository.mine();
    final pairable = state.deviceRepository.pairable();
    final soon = state.deviceRepository.comingSoon();
    expect(mine, isNotEmpty);
    expect(pairable, isNotEmpty);
    expect(soon, isNotEmpty);

    // Owned devices, and nothing the account does not have. The cards are
    // large, so the list is lazy and the later ones have to be scrolled to.
    for (final d in mine) {
      await _reveal(tester, find.text(d.name));
      expect(find.text(d.name), findsOneWidget, reason: 'missing ${d.name}');
    }
    for (final d in [...pairable, ...soon]) {
      expect(find.text(d.name), findsNothing, reason: '${d.name} in the hub');
    }

    state.go(NexaScreen.connect);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Add a device'), findsOneWidget);

    // And the catalogue is the other way round — including the coming-soon
    // products, which are shown as products rather than as empty rows.
    for (final d in [...pairable, ...soon]) {
      await _reveal(tester, find.text(d.name));
      expect(find.text(d.name), findsOneWidget, reason: 'missing ${d.name}');
    }
    // Each coming-soon product carries its own badge, so it reads as a
    // future product rather than an empty row.
    for (final d in soon) {
      await _reveal(tester, find.text(d.name));
      expect(find.text('Coming soon'), findsWidgets);
    }
  });

  testWidgets('the hub has a real empty state when nothing is paired', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    // Not reachable from the demo data — the account always has the phone it
    // is running on — but it is a real state for an account that has none.
    final state = NexaAppState(devices: _EmptyDevices());
    addTearDown(state.dispose);
    state.go(NexaScreen.devices);

    await tester.pumpWidget(nexaTestHost(state));
    await tester.pump(const Duration(seconds: 1));

    expect(find.text('No devices yet.'), findsOneWidget);
    expect(find.text('Add your first device'), findsOneWidget);
    expect(find.text('YOUR DEVICES'), findsNothing);

    await tester.tap(find.text('Add your first device'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.connect);
  });

  testWidgets('a paired device is never offered pairing', (tester) async {
    final state = await _pump(tester, at: NexaScreen.devices);

    for (final d in state.deviceRepository.mine()) {
      state.openDevice(d.id);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      await _reveal(tester, find.text('MANAGE'));

      expect(find.text('MANAGE'), findsOneWidget);
      expect(find.text(d.primaryAction), findsOneWidget);
      expect(
        find.text('Pair device'),
        findsNothing,
        reason: '${d.name} is already on the account',
      );
    }
  });

  testWidgets('the whole tree renders on both grounds', (tester) async {
    for (final palette in [NexaPalette.dark, NexaPalette.light]) {
      tester.view.physicalSize = const Size(390 * 3, 844 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);

      final state = NexaAppState();
      addTearDown(state.dispose);

      await tester.pumpWidget(nexaTestHost(state, palette: palette));
      await tester.pump(const Duration(seconds: 1));

      for (final screen in NexaScreen.values) {
        if (screen == NexaScreen.deviceDetail ||
            screen == NexaScreen.pairIntro) {
          state.openDevice('quest3s');
        }
        if (screen == NexaScreen.memoryDetail) state.openMemory('m1');
        state.go(screen);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 700));
        expect(
          tester.takeException(),
          isNull,
          reason: '${screen.name} threw on ${palette.brightness.name}',
        );
      }
      await tester.pump(const Duration(seconds: 6));
    }
  });

  testWidgets('every tappable control clears a 44px target', (tester) async {
    final state = await _pump(tester, at: NexaScreen.assistant);

    // The two round glyph buttons are drawn at 38 but must be reachable at
    // 44, which is the smallest thing a thumb can be asked to hit.
    for (final screen in [NexaScreen.assistant, NexaScreen.deviceDetail]) {
      if (screen == NexaScreen.deviceDetail) state.openDevice('quest3s');
      state.go(screen);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));

      for (final element in find.byType(NexaPressable).evaluate()) {
        final size = element.size!;
        if (size.width > 120 || size.height > 90) continue; // rows and cards
        if (size.shortestSide < 44.0) {
          final text = find
              .descendant(of: find.byWidget(element.widget), matching: find.byType(Text))
              .evaluate()
              .map((e) => (e.widget as Text).data)
              .join('/');
          fail('control "$text" on ${screen.name} is only $size');
        }
      }
    }
  });

  testWidgets('a reader who turns type up is not ignored', (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);

    final state = NexaAppState();
    addTearDown(state.dispose);
    state.go(NexaScreen.settings);

    await tester.pumpWidget(
      Builder(
        builder: (context) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: const TextScaler.linear(1.2)),
          child: nexaTestHost(state),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));

    final scaled = tester
        .widget<Text>(find.text('Settings').first)
        .style!
        .fontSize!;
    expect(scaled, greaterThan(0));
    expect(tester.takeException(), isNull);

    // And the layout survives it rather than overflowing.
    for (final screen in NexaScreen.values) {
      if (screen == NexaScreen.deviceDetail || screen == NexaScreen.pairIntro) {
        state.openDevice('quest3s');
      }
      if (screen == NexaScreen.memoryDetail) state.openMemory('m1');
      state.go(screen);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      expect(
        tester.takeException(),
        isNull,
        reason: '${screen.name} broke at 1.2x type',
      );
    }
    await tester.pump(const Duration(seconds: 6));
  });

  testWidgets('the appearance setting drives the whole app', (tester) async {
    final state = await _pump(tester, at: NexaScreen.settingsAppearance);
    await tester.pump(const Duration(milliseconds: 500));

    expect(state.prefs.theme, ThemeChoice.system);
    expect(find.text('System'), findsOneWidget);
    expect(find.text('Light'), findsOneWidget);
    expect(find.text('Dark'), findsOneWidget);

    await tester.tap(find.text('Light'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(state.prefs.theme, ThemeChoice.light);

    await tester.tap(find.text('Dark'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(state.prefs.theme, ThemeChoice.dark);
  });

  testWidgets('a memory can be opened and forgotten', (tester) async {
    final state = await _pump(tester, at: NexaScreen.memory);
    await tester.pump(const Duration(milliseconds: 700));

    final before = state.memoryRepository.count;
    state.openMemory('m1');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.memoryDetail);
    expect(find.text('Forget this'), findsOneWidget);

    await tester.tap(find.text('Forget this'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Forget this for good?'), findsOneWidget);

    await tester.tap(find.text('Forget it'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    expect(state.memoryRepository.count, before - 1);
    expect(state.memoryRepository.byId('m1'), isNull);
  });

  testWidgets('the settings tree opens each of its screens', (tester) async {
    final state = await _pump(tester, at: NexaScreen.settings);
    await tester.pump(const Duration(milliseconds: 500));

    const expected = <NexaScreen, String>{
      NexaScreen.settingsVoice: 'How Nexa sounds when she speaks.',
      NexaScreen.settingsAppearance:
          'The room she is in, and what she is made of.',
      NexaScreen.settingsNotifications:
          'When Nexa may reach for your attention.',
      NexaScreen.settingsMemory: 'What she keeps, and what she forgets.',
      NexaScreen.privacy: 'You decide what Nexa can use.',
      NexaScreen.security: 'How you prove it is you.',
      NexaScreen.account: 'Who Nexa thinks you are.',
      NexaScreen.settingsNexa: 'How she sounds and behaves.',
    };

    for (final entry in expected.entries) {
      state.go(entry.key);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 700));
      expect(
        find.text(entry.value),
        findsOneWidget,
        reason: '${entry.key.name} did not render its own content',
      );
    }

    // About is its own shape, without a subtitle.
    state.go(NexaScreen.about);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Version'), findsOneWidget);
  });

  testWidgets('back steps through history rather than dead-ending', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.profile);

    state.go(NexaScreen.settings);
    state.go(NexaScreen.settingsVoice);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    state.back(fallback: NexaScreen.settings);
    expect(state.screen, NexaScreen.settings);

    state.back(fallback: NexaScreen.profile);
    expect(state.screen, NexaScreen.profile);
  });

  testWidgets('back from an auth sub-mode returns to the method choice', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.signup);

    await tester.tap(find.text('Continue with phone'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.authMode, AuthMode.phone);

    await tester.tap(find.text('←'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));

    // Back belongs to the sub-mode first — it must not drop the user out of
    // signing in altogether.
    expect(state.screen, NexaScreen.signup);
    expect(state.authMode, AuthMode.providers);
    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('changing a preference is reflected back in the tree', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.settingsVoice);
    await tester.pump(const Duration(milliseconds: 500));

    expect(state.prefs.voiceId, 'warm');
    await tester.tap(find.text('Quiet'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(state.prefs.voiceId, 'quiet');

    state.go(NexaScreen.settings);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Quiet'), findsOneWidget);
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

/// An account with nothing paired, for the empty state.
class _EmptyDevices implements DeviceRepository {
  final _local = LocalDeviceRepository();

  @override
  List<NexaDevice> mine() => const [];

  @override
  List<NexaDevice> all() => _local.all();

  @override
  List<NexaDevice> pairable() => _local.pairable();

  @override
  List<NexaDevice> comingSoon() => _local.comingSoon();

  @override
  NexaDevice? byId(String id) => _local.byId(id);

  @override
  void markPaired(String id) => _local.markPaired(id);

  @override
  void forget(String id) => _local.forget(id);
}
