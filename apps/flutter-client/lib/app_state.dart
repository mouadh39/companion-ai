import 'dart:async';

import 'package:flutter/widgets.dart';

import 'data/models/memory_entry.dart';
import 'data/models/preferences.dart';
import 'data/repositories/auth_session_repository.dart';
import 'data/repositories/device_link_service.dart';
import 'data/repositories/device_repository.dart';
import 'data/repositories/memory_repository.dart';
import 'data/repositories/pairing_session_repository.dart';
import 'data/repositories/phone_device_repository.dart';
import 'data/repositories/phone_device_store.dart';
import 'data/repositories/preferences_repository.dart';
import 'data/repositories/secure_key_value_store.dart';
import 'data/repositories/session_store.dart';
import 'data/repositories/tqrcg_service.dart';

/// Every screen in the Nexa app.
enum NexaScreen {
  // Onboarding — outside the tab structure.
  welcome('Welcome'),
  signup('Sign up'),
  login('Log in'),
  forgot('Forgot password'),
  meeting('First meeting'),

  // Nexa.
  assistant('Assistant', tab: NexaTab.nexa),
  listening('Listening', tab: NexaTab.nexa),
  speaking('Speaking', tab: NexaTab.nexa),

  // Memory.
  memory('Memory', tab: NexaTab.memory),
  memoryDetail('Memory detail', tab: NexaTab.memory),
  memoryEmpty('Memory empty', tab: NexaTab.memory),

  // Devices.
  devices('Devices', tab: NexaTab.devices),
  deviceDetail('Device', tab: NexaTab.devices),
  connect('Pair a device', tab: NexaTab.devices),
  pairIntro('Pair device', tab: NexaTab.devices),
  pairing('Pairing guide'),
  pairingCode('Pairing code'),
  success('Pairing complete'),

  // You.
  profile('Profile', tab: NexaTab.you),
  settings('Settings', tab: NexaTab.you),
  account('Account', tab: NexaTab.you),
  settingsNexa('Nexa', tab: NexaTab.you),
  settingsVoice('Voice', tab: NexaTab.you),
  settingsAppearance('Appearance', tab: NexaTab.you),
  settingsNotifications('Notifications', tab: NexaTab.you),
  settingsMemory('Memory controls', tab: NexaTab.you),
  privacy('Privacy', tab: NexaTab.you),
  security('Security', tab: NexaTab.you),
  about('About', tab: NexaTab.you),

  // Conditions.
  error('Something went wrong');

  const NexaScreen(this.label, {this.tab});

  final String label;

  /// Which primary destination owns this screen, if any.
  final NexaTab? tab;
}

/// The four primary destinations.
enum NexaTab {
  nexa('Nexa'),
  memory('Memory'),
  devices('Devices'),
  you('You');

  const NexaTab(this.label);

  final String label;

  /// The screen a tab lands on. A getter rather than a field because
  /// NexaScreen already names its tab, and two const enums cannot point at
  /// each other.
  NexaScreen get root => switch (this) {
    NexaTab.nexa => NexaScreen.assistant,
    NexaTab.memory => NexaScreen.memory,
    NexaTab.devices => NexaScreen.devices,
    NexaTab.you => NexaScreen.profile,
  };
}

/// How the auth screen is currently asking for identity.
enum AuthMode { providers, phone, passkey }

/// The app's state, held in one place.
///
/// The design drives every screen from a single state object rather than a
/// navigation stack of routes — presence, auth mode and onboarding step are
/// fields, and the screen is chosen from them. This keeps that shape and adds
/// only what nesting needs: a history to go back through, and which device or
/// memory is being looked at.
class NexaAppState extends ChangeNotifier {
  NexaAppState({
    DeviceRepository? devices,
    MemoryRepository? memories,
    PreferencesRepository? preferences,
    TqrcgService? tqrcg,
    DeviceLinkService? link,
    AuthSessionRepository? authSession,
    PhoneDeviceRepository? phoneDevice,
    PairingSessionRepository? pairingSession,
  }) : deviceRepository = devices ?? LocalDeviceRepository(),
       memoryRepository = memories ?? LocalMemoryRepository(),
       preferencesRepository = preferences ?? LocalPreferencesRepository(),
       tqrcgService = tqrcg ?? LocalTqrcgService(),
       deviceLinkService = link ?? LocalDeviceLinkService(),
       authSession =
           authSession ??
           AuthSessionRepository(
             sessionStore: SessionStore(PlatformSecureKeyValueStore()),
             // No SupabaseAuthConfig for the default instance — no build in
             // this repository has a real project URL or anon key to give
             // it yet. See the report: every method that would need one
             // throws AuthNotConfiguredException rather than pretending to
             // work.
           ) {
    // In the constructor body, not the initializer list: PhoneDeviceRepository
    // must share this exact `this.authSession` instance (both as the token
    // source and the identity source), which is only available once the
    // initializer list above has finished resolving it.
    this.phoneDevice =
        phoneDevice ??
        PhoneDeviceRepository(
          store: PhoneDeviceStore(PlatformSecureKeyValueStore()),
          tokenProvider: this.authSession,
          identity: this.authSession,
          // No NexaBackend for the default instance — no build in this
          // repository has a real Nexa backend base URL configured yet.
          // See the report: ensureRegistered throws
          // BackendNotConfiguredException rather than pretending to work.
        );
    // Same reasoning, same instance-sharing requirement as phoneDevice
    // above: this needs both this.authSession (for its own bearer token)
    // and this.phoneDevice (to resolve phoneDeviceId), both only available
    // once the initializer list and the phoneDevice assignment above have
    // run.
    this.pairingSession =
        pairingSession ??
        PairingSessionRepository(
          tokenProvider: this.authSession,
          phoneDevice: this.phoneDevice,
          // No NexaBackend here either — same reason as phoneDevice.
        );
  }

  /// The data the screens read. Local implementations today; the same
  /// interfaces when the backend exists.
  final DeviceRepository deviceRepository;
  final MemoryRepository memoryRepository;
  final PreferencesRepository preferencesRepository;
  final TqrcgService tqrcgService;
  final DeviceLinkService deviceLinkService;

  /// This phone's own Supabase session — the "authenticated session
  /// provider" between the UI and `NexaBackend`. No screen calls into this
  /// yet (see the report on why not); it is wired here so the boundary
  /// exists at the one point in the app's architecture it belongs, ready
  /// for a screen to use once there is a real sign-in flow behind it.
  final AuthSessionRepository authSession;

  /// This phone's own device row on the backend — registered once per
  /// account, remembered across restarts. Also not called from any screen
  /// yet; see the report.
  late final PhoneDeviceRepository phoneDevice;

  /// Turns a headset's enrolment handle into a pairing session this phone
  /// can display. Not called from any screen or from `TqrcgService` yet —
  /// see the report on why not.
  late final PairingSessionRepository pairingSession;

  NexaScreen _screen = NexaScreen.welcome;
  final List<NexaScreen> _history = [];

  AuthMode _authMode = AuthMode.providers;
  String _name = '';
  int _meetStep = 0;

  String? _deviceId;
  String? _memoryId;
  MemoryFilter _memoryFilter = MemoryFilter.recent;
  int _pairStep = 0;
  PairingPhase _pairingPhase = PairingPhase.idle;

  Timer? _presenceTimer;

  NexaScreen get screen => _screen;
  AuthMode get authMode => _authMode;
  String get name => _name;
  String get email => preferencesRepository.email;
  int get meetStep => _meetStep;
  String? get deviceId => _deviceId;
  String? get memoryId => _memoryId;
  MemoryFilter get memoryFilter => _memoryFilter;
  int get pairStep => _pairStep;

  /// How far the pairing has got, across discovery, connection and the code.
  PairingPhase get pairingPhase => _pairingPhase;
  NexaPreferences get prefs => preferencesRepository.current;

  /// The first word of the name, which is all the design ever shows.
  String get firstName => _name.trim().split(' ').first;

  String get displayName => firstName.isEmpty ? 'Your account' : firstName;

  bool isOn(List<NexaScreen> screens) => screens.contains(_screen);

  /// Nexa is present — the assistant screen and its two live states.
  bool get isPresence => isOn([
    NexaScreen.assistant,
    NexaScreen.listening,
    NexaScreen.speaking,
  ]);

  /// Onboarding and the pairing flow own the whole screen.
  bool get tabsVisible =>
      _screen.tab != null &&
      !isOn([NexaScreen.pairing, NexaScreen.pairingCode, NexaScreen.success]);

  /// Which tab should read as active.
  NexaTab? get activeTab => _screen.tab;

  bool get canGoBack => _history.isNotEmpty;

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------

  /// Move to [screen], remembering where we came from.
  void go(NexaScreen screen) {
    _presenceTimer?.cancel();
    if (screen != _screen) _history.add(_screen);
    _screen = screen;
    notifyListeners();
  }

  /// Move to a primary destination, clearing the history — a tab is a fresh
  /// start, not another step deeper.
  void goTab(NexaTab tab) {
    _presenceTimer?.cancel();
    _history.clear();
    _screen = tab.root;
    _deviceId = null;
    _memoryId = null;
    notifyListeners();
  }

  /// Step back, or to [fallback] when there is nowhere to step back to.
  void back({NexaScreen? fallback}) {
    _presenceTimer?.cancel();
    if (_history.isNotEmpty) {
      _screen = _history.removeLast();
    } else if (fallback != null) {
      _screen = fallback;
    }
    notifyListeners();
  }

  /// Replace the whole history — used when a flow completes and going back
  /// into it would make no sense.
  void goRoot(NexaScreen screen) {
    _presenceTimer?.cancel();
    _history.clear();
    _screen = screen;
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // Onboarding and identity
  // ------------------------------------------------------------------

  void setAuthMode(AuthMode mode) {
    _authMode = mode;
    notifyListeners();
  }

  void setName(String value) {
    _name = value;
    notifyListeners();
  }

  void setEmail(String value) {
    preferencesRepository.email = value;
    notifyListeners();
  }

  void setMeetStep(int step) {
    _meetStep = step;
    notifyListeners();
  }

  void toggleAuth() {
    _screen = _screen == NexaScreen.login
        ? NexaScreen.signup
        : NexaScreen.login;
    _authMode = AuthMode.providers;
    notifyListeners();
  }

  /// Leave the account. Local only — no session exists to end yet.
  void logOut() {
    _history.clear();
    _screen = NexaScreen.welcome;
    _name = '';
    _meetStep = 0;
    _authMode = AuthMode.providers;
    notifyListeners();
    // Synchronous and first: the app must stop treating itself as having a
    // registered device the instant sign-out happens, not after a network
    // call settles — see PhoneDeviceRepository.clearActiveDevice. The
    // persisted record is left alone; restore() re-validates it against
    // whoever signs in next.
    phoneDevice.clearActiveDevice();
    // Fire-and-forget: leaving the account must never wait on a network
    // call, and this is safe to call whether or not a session was ever
    // actually established — see AuthSessionRepository.logout.
    unawaited(authSession.logout());
  }

  // ------------------------------------------------------------------
  // Preferences
  // ------------------------------------------------------------------

  void updatePrefs(NexaPreferences next) {
    preferencesRepository.update(next);
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // Memory
  // ------------------------------------------------------------------

  void setMemoryFilter(MemoryFilter filter) {
    _memoryFilter = filter;
    notifyListeners();
  }

  void openMemory(String id) {
    _memoryId = id;
    go(NexaScreen.memoryDetail);
  }

  /// Forget one entry and leave the detail screen behind it.
  void forgetMemory(String id) {
    memoryRepository.forget(id);
    _memoryId = null;
    if (_screen == NexaScreen.memoryDetail) back(fallback: NexaScreen.memory);
    notifyListeners();
  }

  void forgetAllMemories() {
    memoryRepository.forgetAll();
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // Devices and pairing
  // ------------------------------------------------------------------

  void openDevice(String id) {
    _deviceId = id;
    go(NexaScreen.deviceDetail);
  }

  void startPairing(String id) {
    _deviceId = id;
    _pairStep = 0;
    _pairingPhase = PairingPhase.idle;
    go(NexaScreen.pairIntro);
  }

  void beginGuide() {
    _pairStep = 0;
    _pairingPhase = PairingPhase.idle;
    go(NexaScreen.pairing);
  }

  /// Recorded by whichever service is driving the pairing right now — the
  /// link while the phone is finding and connecting to the headset, then the
  /// TQRCG service while the code is on screen.
  void setPairingPhase(PairingPhase phase) {
    if (_pairingPhase == phase) return;
    _pairingPhase = phase;
    notifyListeners();
  }

  void setPairStep(int step) {
    _pairStep = step;
    notifyListeners();
  }

  /// The pairing completed. Record it and land on the confirmation.
  void completePairing() {
    final id = _deviceId;
    if (id != null) deviceRepository.markPaired(id);
    _pairingPhase = PairingPhase.paired;
    _screen = NexaScreen.success;
    notifyListeners();
  }

  void forgetDevice(String id) {
    deviceRepository.forget(id);
    notifyListeners();
  }

  // ------------------------------------------------------------------
  // Presence
  // ------------------------------------------------------------------

  /// A scripted turn: Nexa listens, answers, then settles back to idle.
  ///
  /// The timing is local because no turn pipeline is attached yet; when
  /// `@nexa/core` drives this, the same three states come from it.
  void talk() {
    if (isOn([NexaScreen.listening, NexaScreen.speaking])) {
      _presenceTimer?.cancel();
      _screen = NexaScreen.assistant;
      notifyListeners();
      return;
    }
    _presenceTimer?.cancel();
    _screen = NexaScreen.listening;
    notifyListeners();

    _presenceTimer = Timer(const Duration(milliseconds: 2600), () {
      _screen = NexaScreen.speaking;
      notifyListeners();
      _presenceTimer = Timer(const Duration(milliseconds: 5200), () {
        _screen = NexaScreen.assistant;
        notifyListeners();
      });
    });
  }

  @override
  void dispose() {
    _presenceTimer?.cancel();
    super.dispose();
  }
}

/// Hands the state down the tree without pulling in a state-management
/// package.
class NexaScope extends InheritedNotifier<NexaAppState> {
  const NexaScope({
    super.key,
    required NexaAppState state,
    required super.child,
  }) : super(notifier: state);

  static NexaAppState of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<NexaScope>();
    assert(scope != null, 'No NexaScope above this widget.');
    return scope!.notifier!;
  }
}
