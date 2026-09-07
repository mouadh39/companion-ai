import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/models/device.dart';
import 'package:nexa_client/data/models/memory_entry.dart';
import 'package:nexa_client/data/repositories/device_link_service.dart';
import 'package:nexa_client/data/repositories/device_repository.dart';
import 'package:nexa_client/data/repositories/memory_repository.dart';
import 'package:nexa_client/data/repositories/tqrcg_service.dart';
import 'package:nexa_client/main.dart';
import 'package:nexa_client/widgets/nexa_controls.dart';
import 'package:nexa_client/theme/nexa_theme.dart';

/// Mounts the app at a phone size with the given state.
///
/// [devices]/[memories] are for the handful of tests that need something
/// real to find or forget — production starts both empty (see the report),
/// so a test that needs a paired device or a kept memory brings its own
/// fixture rather than leaning on a seed that no longer exists.
Future<NexaAppState> _pump(
  WidgetTester tester, {
  NexaScreen? at,
  DeviceRepository? devices,
  MemoryRepository? memories,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3.0;
  addTearDown(tester.view.reset);

  // The scripted pairing doubles: these tests walk the pairing *screens*
  // without a headset on the network, so they inject the UI stand-ins.
  // Production composes the real LAN transport + backend-authoritative
  // `RealTqrcgService` instead (see `NexaAppState`).
  final state = NexaAppState(
    devices: devices,
    memories: memories,
    tqrcg: LocalTqrcgService(),
    link: LocalDeviceLinkService(),
  );
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
    // A fresh account has kept nothing yet, so this lands on the real
    // empty state rather than the populated subtitle.
    expect(find.text("Nexa hasn't remembered anything yet."), findsOneWidget);

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

    // A fresh account starts with nothing paired — the real empty state,
    // not a seeded device.
    expect(find.text('No devices yet.'), findsOneWidget);
    expect(find.text('YOUR DEVICES'), findsNothing);
    expect(find.text('Meta Quest 3S'), findsNothing);

    await tester.tap(find.text('Add device'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 700));
    expect(state.screen, NexaScreen.connect);
    expect(find.text('Choose where Nexa should live next.'), findsOneWidget);
    // Third card down now that Quest 3 and Watch are real catalogue entries
    // ahead of it (see the report) — the list is lazy, so it has to be
    // scrolled to, same as the other cards this file already reveals.
    await _reveal(tester, find.text('Meta Quest 3S'));
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
    // A fresh account starts with nothing paired (see the report), so this
    // test — which is specifically about separating owned devices from the
    // catalogue — brings its own fixture with one real paired device rather
    // than relying on a production seed that no longer exists.
    final state = await _pump(
      tester,
      at: NexaScreen.devices,
      devices: LocalDeviceRepository()..markPaired('quest3'),
    );
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

    // The production default now starts here too (see the report), but this
    // fixture keeps the test explicit about which state it means to exercise
    // rather than relying on that default silently staying empty.
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
    // Same reasoning as the test above: a fresh account has nothing paired,
    // so this needs its own fixture to have anything to iterate at all.
    final state = await _pump(
      tester,
      at: NexaScreen.devices,
      devices: LocalDeviceRepository()..markPaired('quest3'),
    );

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
    // Production starts with nothing kept (see the report), so this test —
    // whose whole point is forgetting a real entry — brings its own
    // fixture rather than relying on a seed that no longer exists.
    final state = await _pump(
      tester,
      at: NexaScreen.memory,
      memories: _FixtureMemories(),
    );
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

  testWidgets('a provider tap is honest — it says so, it does not navigate', (
    tester,
  ) async {
    final state = await _pump(tester, at: NexaScreen.signup);

    await tester.tap(find.text('Continue with Meta'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Still on sign-up — no fake OAuth navigation — with an honest line.
    expect(state.screen, NexaScreen.signup);
    expect(find.textContaining('Meta sign-in isn’t connected yet'),
        findsOneWidget);
    expect(find.text('Continue with Google'), findsOneWidget);
  });

  testWidgets('the email form is on the auth surface, not behind a sub-mode', (
    tester,
  ) async {
    await _pump(tester, at: NexaScreen.login);

    // Providers and the real form are both present immediately — no
    // "continue with email" step in between.
    expect(find.text('Welcome back.'), findsOneWidget);
    expect(find.text('OR USE EMAIL'), findsOneWidget);
    expect(find.text('EMAIL'), findsOneWidget);
    expect(find.text('PASSWORD'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Forgot password?'), findsOneWidget);
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

/// A fixture with exactly one entry, for the tests that need something real
/// to open and forget. Production starts empty (see the report), so this is
/// test data kept separate from it, not a restored seed.
class _FixtureMemories implements MemoryRepository {
  final List<MemoryEntry> _entries = [
    const MemoryEntry(
      id: 'm1',
      text: 'A fixture entry, not a real memory.',
      when: 'today',
      kind: MemoryKind.preference,
      important: true,
    ),
  ];

  @override
  List<MemoryEntry> all() => List.unmodifiable(_entries);

  @override
  List<MemoryEntry> byFilter(MemoryFilter filter) => all();

  @override
  MemoryEntry? byId(String id) {
    for (final e in _entries) {
      if (e.id == id) return e;
    }
    return null;
  }

  @override
  int get count => _entries.length;

  @override
  int get importantCount => _entries.where((e) => e.important).length;

  @override
  int get peopleCount =>
      _entries.where((e) => e.kind == MemoryKind.people).length;

  @override
  void forget(String id) => _entries.removeWhere((e) => e.id == id);

  @override
  void forgetAll() => _entries.clear();
}
