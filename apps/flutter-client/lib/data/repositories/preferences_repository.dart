import '../models/preferences.dart';

/// Holds what the user has chosen about how Nexa behaves.
///
/// Every settings screen reads and writes through this, so persistence and
/// sync become one implementation rather than a change to each screen.
abstract interface class PreferencesRepository {
  NexaPreferences get current;

  void update(NexaPreferences next);

  List<VoiceOption> get voices;

  List<AppearanceOption> get appearances;

  /// The sign-in methods currently on the account.
  List<SignInMethod> get activeSignInMethods;

  /// The account identity. Local until the backend owns accounts.
  String get email;

  set email(String value);
}

/// An in-process store.
///
/// Local demo state, not backend state: choices last as long as the app is
/// running and reach no server.
class LocalPreferencesRepository implements PreferencesRepository {
  LocalPreferencesRepository();

  NexaPreferences _prefs = const NexaPreferences();
  String _email = 'you@example.com';

  @override
  NexaPreferences get current => _prefs;

  @override
  void update(NexaPreferences next) => _prefs = next;

  @override
  List<VoiceOption> get voices => const [
    VoiceOption(id: 'warm', name: 'Warm', note: 'Softer, slower, more pauses'),
    VoiceOption(id: 'clear', name: 'Clear', note: 'Direct and even'),
    VoiceOption(
      id: 'quiet',
      name: 'Quiet',
      note: 'Lower and close, for late nights',
    ),
    VoiceOption(id: 'bright', name: 'Bright', note: 'Lighter and quicker'),
  ];

  @override
  List<AppearanceOption> get appearances => const [
    AppearanceOption(
      id: 'emerald',
      name: 'Emerald',
      note: "Nexa's own material",
    ),
    AppearanceOption(
      id: 'silver',
      name: 'Silver',
      note: 'Cooler, brighter under light',
    ),
    AppearanceOption(
      id: 'graphite',
      name: 'Graphite',
      note: 'Quiet, almost unlit',
    ),
    AppearanceOption(
      id: 'stealth',
      name: 'Stealth black',
      note: 'Present only in silhouette',
    ),
  ];

  @override
  List<SignInMethod> get activeSignInMethods => const [
    SignInMethod.apple,
    SignInMethod.passkey,
  ];

  @override
  String get email => _email;

  @override
  set email(String value) => _email = value;
}
