import 'dart:async';

import 'package:flutter/material.dart';

import 'app_state.dart';
import 'screens/assistant_screen.dart';
import 'screens/auth_screen.dart';
import 'screens/devices/connect_screen.dart';
import 'screens/devices/device_detail_screen.dart';
import 'screens/devices/devices_screen.dart';
import 'screens/devices/pair_intro_screen.dart';
import 'screens/devices/pair_success_screen.dart';
import 'screens/devices/pairing_guide_screen.dart';
import 'screens/devices/tqrcg_code_screen.dart';
import 'screens/entrance_screen.dart';
import 'screens/meeting_screen.dart';
import 'screens/memory/memory_detail_screen.dart';
import 'screens/memory/memory_screen.dart';
import 'screens/welcome_screen.dart';
import 'screens/you/profile_screen.dart';
import 'screens/you/settings_screens.dart';
import 'theme/nexa_theme.dart';
import 'widgets/nexa_controls.dart';
import 'widgets/nexa_mark.dart';
import 'widgets/nexa_tab_bar.dart';

void main() => runApp(const NexaApp());

class NexaApp extends StatefulWidget {
  const NexaApp({super.key, this.state});

  /// Overrides the app's state. `null` in the real app, which builds its own
  /// — this exists purely so a test can inject an [NexaAppState] wired to a
  /// fake or mocked [AuthSessionRepository] and drive the same restore-on-
  /// launch path this widget runs for real, without a real secure-storage
  /// platform channel or network call.
  final NexaAppState? state;

  @override
  State<NexaApp> createState() => _NexaAppState();
}

class _NexaAppState extends State<NexaApp> {
  late final _state = widget.state ?? NexaAppState();

  @override
  void initState() {
    super.initState();
    // Restores the persisted session and this phone's device record, in that
    // order (PhoneDeviceRepository.restore reads currentUserId). It does not
    // navigate: `EntranceScreen` calls `completeEntrance()` when the launch
    // animation finishes, and that is what runs `routeAfterAuthentication`
    // for a recognised account — so a returning user still gets the short
    // entrance instead of being snapped past it the instant the token loads.
    unawaited(_state.startup());
  }

  @override
  void dispose() {
    // Only disposed when this widget created it. An injected state is a
    // test's own object, with its own teardown — disposing it a second time
    // here would crash on the ChangeNotifier "used after being disposed"
    // assertion the moment a test's own `addTearDown` runs.
    if (widget.state == null) _state.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // The state is above the appearance, because the appearance is one of the
    // things it holds.
    return NexaScope(
      state: _state,
      child: ListenableBuilder(
        listenable: _state,
        builder: (context, _) => const _NexaAppShell(),
      ),
    );
  }
}

/// Resolves the appearance and hands it, and one text colour, to everything
/// below.
class _NexaAppShell extends StatelessWidget {
  const _NexaAppShell();

  @override
  Widget build(BuildContext context) {
    final state = NexaScope.of(context);
    final platform = MediaQuery.maybeOf(context);

    final dark = switch (state.prefs.theme) {
      ThemeChoice.dark => true,
      ThemeChoice.light => false,
      ThemeChoice.system =>
        (platform?.platformBrightness ?? Brightness.dark) == Brightness.dark,
    };
    var c = dark ? NexaPalette.dark : NexaPalette.light;
    if (platform?.highContrast ?? false) c = c.forHighContrast();

    // The platform's own accessibility setting counts as much as ours.
    final reduced =
        state.prefs.reducedMotion || (platform?.disableAnimations ?? false);

    return NexaAppearance(
      palette: c,
      reducedMotion: reduced,
      child: MaterialApp(
        title: 'Nexa',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          brightness: c.brightness,
          scaffoldBackgroundColor: c.void_,
          fontFamily: NexaType.fontFamily,
          // The system draws no chrome of its own — every surface in this app
          // is specified by the design.
          splashFactory: NoSplash.splashFactory,
          highlightColor: const Color(0x00000000),
        ),
        scrollBehavior: const NexaScrollBehavior(),
        builder: (context, child) => _TextScale(
          child: NexaAppearance(
            // MaterialApp builds its navigator below the app's own context, so
            // the appearance has to be re-planted inside it.
            palette: c,
            reducedMotion: reduced,
            child: DefaultTextStyle(
              // Type that names no colour inherits the palette's ink.
              style: NexaType.ui(color: c.ink),
              child: child ?? const SizedBox.shrink(),
            ),
          ),
        ),
        home: const NexaHome(),
      ),
    );
  }
}

/// Honours the reader's text size, within a bound.
///
/// The app used to ignore it outright, which is the wrong trade: someone who
/// has turned type up has done so because they need it. Nexa's layouts are
/// built on a fixed spacing scale, though, so the very largest accessibility
/// sizes would break them rather than serve anyone. Scaling is passed through
/// up to 1.3× and held there.
class _TextScale extends StatelessWidget {
  const _TextScale({required this.child});

  static const max = 1.3;

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final q = MediaQuery.of(context);
    final scaled = q.textScaler.scale(15) / 15;
    if (scaled <= max) return child;
    return MediaQuery(
      data: q.copyWith(textScaler: const TextScaler.linear(max)),
      child: child,
    );
  }
}

/// This is a phone app and the design draws no scrollbar. Running it in a
/// desktop browser would otherwise paint one over every list.
class NexaScrollBehavior extends MaterialScrollBehavior {
  const NexaScrollBehavior();

  @override
  Widget buildScrollbar(
    BuildContext context,
    Widget child,
    ScrollableDetails details,
  ) =>
      child;
}

/// Routes the current screen and keeps the persistent chrome — the tab bar —
/// above it.
class NexaHome extends StatelessWidget {
  const NexaHome({super.key});

  @override
  Widget build(BuildContext context) {
    final state = NexaScope.of(context);

    final screen = switch (state.screen) {
      // The launch experience.
      NexaScreen.entrance => const EntranceScreen(),

      // Onboarding.
      NexaScreen.welcome => const WelcomeScreen(),
      NexaScreen.signup ||
      NexaScreen.login ||
      NexaScreen.forgot =>
        const AuthScreen(),
      NexaScreen.meeting => const MeetingScreen(),

      // Nexa.
      NexaScreen.assistant ||
      NexaScreen.listening ||
      NexaScreen.speaking =>
        const AssistantScreen(),

      // Memory.
      NexaScreen.memory => const MemoryScreen(),
      NexaScreen.memoryDetail => const MemoryDetailScreen(),
      NexaScreen.memoryEmpty => const MemoryEmptyView(),

      // Devices and pairing.
      NexaScreen.devices => const DevicesScreen(),
      NexaScreen.deviceDetail => const DeviceDetailScreen(),
      NexaScreen.connect => const ConnectScreen(),
      NexaScreen.pairIntro => const PairIntroScreen(),
      NexaScreen.pairing => const PairingGuideScreen(),
      NexaScreen.pairingCode => const TqrcgCodeScreen(),
      NexaScreen.success => const PairSuccessScreen(),

      // You.
      NexaScreen.profile => const ProfileScreen(),
      NexaScreen.settings => const SettingsScreen(),
      NexaScreen.account => const AccountScreen(),
      NexaScreen.settingsNexa => const NexaSettingsScreen(),
      NexaScreen.settingsVoice => const VoiceSettingsScreen(),
      NexaScreen.settingsAppearance => const AppearanceSettingsScreen(),
      NexaScreen.settingsNotifications => const NotificationSettingsScreen(),
      NexaScreen.settingsMemory => const MemorySettingsScreen(),
      NexaScreen.privacy => const PrivacyScreen(),
      NexaScreen.security => const SecurityScreen(),
      NexaScreen.about => const AboutScreen(),
      NexaScreen.error => const NexaErrorScreen(),
    };

    // Text fields need a Material ancestor, and the app deliberately has no
    // Scaffold — every surface it draws is specified by the design.
    return Material(
      type: MaterialType.transparency,
      child: NexaPhoneFrame(
        child: Stack(
          children: [
            Positioned.fill(
              child: AnimatedSwitcher(
                duration: NexaMotion.slow,
                switchInCurve: NexaMotion.enter,
                // Cross-fade only. The design never slides between screens.
                transitionBuilder: (child, animation) =>
                    FadeTransition(opacity: animation, child: child),
                child: KeyedSubtree(
                  key: ValueKey(_groupOf(state.screen)),
                  child: screen,
                ),
              ),
            ),
            if (state.tabsVisible) const NexaTabBar(),
          ],
        ),
      ),
    );
  }

  /// Screens that share a surface should not cross-fade between each other —
  /// the auth modes and the three presence states are one screen changing,
  /// not a navigation.
  String _groupOf(NexaScreen s) => switch (s) {
        NexaScreen.signup || NexaScreen.login || NexaScreen.forgot => 'auth',
        NexaScreen.assistant ||
        NexaScreen.listening ||
        NexaScreen.speaking =>
          'presence',
        _ => s.name,
      };
}

/// On a phone this is a no-op. On a desktop or a wide browser window the app
/// is drawn at its real size inside a device frame, the way the design
/// presents it, rather than stretched across a monitor.
class NexaPhoneFrame extends StatelessWidget {
  const NexaPhoneFrame({super.key, required this.child});

  static const width = 390.0;
  static const height = 844.0;

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final size = MediaQuery.sizeOf(context);
    final needsFrame = size.width > width + 80 && size.height > height + 40;

    if (!needsFrame) return ColoredBox(color: c.void_, child: child);

    return ColoredBox(
      color: c.void_,
      child: Center(
        child: Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            color: c.void_,
            borderRadius: NexaRadius.frameAll,
            border: Border.all(color: c.hairlineStrong, width: 1),
            boxShadow: c.frameShadow,
          ),
          clipBehavior: Clip.antiAlias,
          child: MediaQuery(
            // Inside the frame the app should lay out as if it owned a phone,
            // not a desktop — otherwise SafeArea and text scaling come from
            // the host window.
            data: MediaQuery.of(context).copyWith(
              size: const Size(width, height),
              padding: EdgeInsets.zero,
              viewPadding: EdgeInsets.zero,
              viewInsets: EdgeInsets.zero,
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

/// Nexa could not be reached. Nothing said is lost.
class NexaErrorScreen extends StatelessWidget {
  const NexaErrorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return DecoratedBox(
      decoration: BoxDecoration(color: c.void_),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(32, 56, 32, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: NexaBackButton(
                  onTap: () => state.back(fallback: NexaScreen.assistant),
                  size: 20,
                ),
              ),
              const Expanded(
                child: Center(
                  child: NexaMark(
                    size: 104,
                    material: NexaMarkMaterial.graphite,
                    glow: 0,
                    breathe: Duration(seconds: 8),
                    opacity: 0.6,
                  ),
                ),
              ),
              Text(
                "Couldn't reach Nexa.",
                textAlign: TextAlign.center,
                style: NexaType.display(size: 26).copyWith(height: 1.2),
              ),
              const SizedBox(height: 12),
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 260),
                  child: Text(
                    'Check your connection and try again. Nothing you said '
                    'was lost.',
                    textAlign: TextAlign.center,
                    style: NexaType.body(
                      size: 14.5,
                      color: c.ink45,
                    ).copyWith(height: 1.6),
                  ),
                ),
              ),
              const SizedBox(height: 32),
              NexaPrimaryButton(
                label: 'Try again',
                // Re-runs the same real check that led here — never just
                // drops the account onto the assistant, which would be
                // exactly the "network failure read as a fresh account"
                // mistake this screen exists to prevent.
                onTap: () => state.routeAfterAuthentication(),
              ),
              const SizedBox(height: 11),
              NexaQuietButton(
                label: 'Account settings',
                padding: 14,
                size: 13.5,
                color: c.ink40,
                onTap: () => state.goTab(NexaTab.you),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
