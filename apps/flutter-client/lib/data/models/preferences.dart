import '../../theme/nexa_colors.dart' show ThemeChoice;

export '../../theme/nexa_colors.dart' show ThemeChoice;

/// One of the voices Nexa can speak in.
class VoiceOption {
  const VoiceOption({
    required this.id,
    required this.name,
    required this.note,
  });

  final String id;
  final String name;

  /// How it differs, in a handful of words.
  final String note;
}

/// The material the mark is cast in on this account's surfaces.
class AppearanceOption {
  const AppearanceOption({
    required this.id,
    required this.name,
    required this.note,
  });

  final String id;
  final String name;
  final String note;
}

/// How readily Nexa speaks without being asked.
enum SpeakFirst {
  never('Never'),
  rarely('Rarely'),
  often('Often');

  const SpeakFirst(this.label);

  final String label;
}

/// Everything the user has chosen about how Nexa behaves.
///
/// Held as one immutable value so a settings screen changes exactly one field
/// and the rest is carried forward untouched.
class NexaPreferences {
  const NexaPreferences({
    this.voiceId = 'warm',
    this.appearanceId = 'emerald',
    this.theme = ThemeChoice.system,
    this.speakFirst = SpeakFirst.rarely,
    this.wakeWord = true,
    this.subtitles = true,
    this.reducedMotion = false,
    this.rememberNewThings = true,
    this.rememberPeople = true,
    this.storeVoiceRecordings = false,
    this.conversationHistory = true,
    this.notifyMemory = true,
    this.notifyDevices = true,
    this.notifyProduct = false,
  });

  final String voiceId;
  final String appearanceId;

  /// Which ground the whole app is drawn on.
  final ThemeChoice theme;
  final SpeakFirst speakFirst;
  final bool wakeWord;
  final bool subtitles;
  final bool reducedMotion;

  final bool rememberNewThings;
  final bool rememberPeople;

  final bool storeVoiceRecordings;
  final bool conversationHistory;

  final bool notifyMemory;
  final bool notifyDevices;
  final bool notifyProduct;

  NexaPreferences copyWith({
    String? voiceId,
    String? appearanceId,
    ThemeChoice? theme,
    SpeakFirst? speakFirst,
    bool? wakeWord,
    bool? subtitles,
    bool? reducedMotion,
    bool? rememberNewThings,
    bool? rememberPeople,
    bool? storeVoiceRecordings,
    bool? conversationHistory,
    bool? notifyMemory,
    bool? notifyDevices,
    bool? notifyProduct,
  }) {
    return NexaPreferences(
      voiceId: voiceId ?? this.voiceId,
      appearanceId: appearanceId ?? this.appearanceId,
      theme: theme ?? this.theme,
      speakFirst: speakFirst ?? this.speakFirst,
      wakeWord: wakeWord ?? this.wakeWord,
      subtitles: subtitles ?? this.subtitles,
      reducedMotion: reducedMotion ?? this.reducedMotion,
      rememberNewThings: rememberNewThings ?? this.rememberNewThings,
      rememberPeople: rememberPeople ?? this.rememberPeople,
      storeVoiceRecordings: storeVoiceRecordings ?? this.storeVoiceRecordings,
      conversationHistory: conversationHistory ?? this.conversationHistory,
      notifyMemory: notifyMemory ?? this.notifyMemory,
      notifyDevices: notifyDevices ?? this.notifyDevices,
      notifyProduct: notifyProduct ?? this.notifyProduct,
    );
  }
}

/// A way the user can prove who they are. The auth screen offers all of
/// these; Security reports which are actually in use.
enum SignInMethod {
  google('Google'),
  apple('Apple'),
  meta('Meta'),
  phone('Phone'),
  passkey('Passkey');

  const SignInMethod(this.label);

  final String label;
}
