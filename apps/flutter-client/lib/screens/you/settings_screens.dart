import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/preferences.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_glass.dart';
import '../../widgets/nexa_icons.dart';
import '../../widgets/nexa_mark.dart';
import '../../widgets/nexa_page.dart';

// ---------------------------------------------------------------------------
// Settings — the hub.
// ---------------------------------------------------------------------------

/// Everything about your Nexa, grouped by what it governs rather than by
/// which system owns it.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = NexaScope.of(context);
    final prefs = state.prefs;
    final repo = state.preferencesRepository;

    return NexaPage(
      title: 'Settings',
      subtitle: 'Everything about your Nexa.',
      onBack: () => state.back(fallback: NexaScreen.profile),
      children: [
        NexaSectionLabel('Appearance'),
        _ThemeSegmented(
          selected: prefs.theme,
          onPick: (t) => state.updatePrefs(prefs.copyWith(theme: t)),
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Experience'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.voice,
              label: 'Voice',
              value: repo.voices.firstWhere((v) => v.id == prefs.voiceId).name,
              onTap: () => state.go(NexaScreen.settingsVoice),
            ),
            NexaRow(
              icon: NexaIcon.theme,
              label: 'Appearance',
              value: repo.appearances
                  .firstWhere((a) => a.id == prefs.appearanceId)
                  .name,
              onTap: () => state.go(NexaScreen.settingsAppearance),
            ),
            NexaRow(
              icon: NexaIcon.assistant,
              label: 'Nexa',
              value: 'Presence',
              onTap: () => state.go(NexaScreen.settingsNexa),
            ),
            NexaRow(
              icon: NexaIcon.notifications,
              label: 'Notifications',
              onTap: () => state.go(NexaScreen.settingsNotifications),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('What she keeps'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.memory,
              label: 'Memory',
              value: '${state.memoryRepository.count} kept',
              onTap: () => state.go(NexaScreen.settingsMemory),
            ),
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Privacy',
              onTap: () => state.go(NexaScreen.privacy),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Account'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.profile,
              label: 'Profile',
              value: (state.firstName.isEmpty && state.username.isEmpty)
                  ? 'Not set up'
                  : state.displayName,
              onTap: () => state.go(NexaScreen.account),
            ),
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Security',
              onTap: () => state.go(NexaScreen.security),
            ),
            NexaRow(
              icon: NexaIcon.devices,
              label: 'Paired devices',
              value: '${state.deviceRepository.mine().length}',
              onTap: () => state.goTab(NexaTab.devices),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.help,
              label: 'About Nexa',
              onTap: () => state.go(NexaScreen.about),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaOutlineButton(label: 'Log out', danger: true, onTap: state.logOut),
      ],
    );
  }
}

/// The System / Light / Dark control, promoted onto the Settings root the
/// way the approved design puts it there — a live segmented switch on a solid
/// group card, with a one-line note for the current choice. The full
/// Appearance screen (material, motion, the mark preview) is still one tap
/// deeper.
class _ThemeSegmented extends StatelessWidget {
  const _ThemeSegmented({required this.selected, required this.onPick});

  final ThemeChoice selected;
  final ValueChanged<ThemeChoice> onPick;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: c.group,
        borderRadius: NexaRadius.groupAll,
        border: Border.all(color: c.hairlineStrong, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: c.surfaceQuiet,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                for (final t in ThemeChoice.values)
                  Expanded(
                    child: NexaPressable(
                      onTap: () => onPick(t),
                      scale: 0.97,
                      child: AnimatedContainer(
                        duration: NexaMotion.fast,
                        curve: NexaMotion.curve,
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: t == selected ? c.emeraldWash : null,
                          borderRadius: BorderRadius.circular(11),
                          border: Border.all(
                            color: t == selected
                                ? c.emeraldBorder
                                : const Color(0x00000000),
                            width: 1,
                          ),
                        ),
                        child: Text(
                          t.label,
                          style: NexaType.ui(
                            size: 12.5,
                            weight: FontWeight.w500,
                            color: t == selected ? c.emeraldBright : c.ink50,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Text(
            selected.note,
            style: NexaType.body(size: 12.5, color: c.ink42).copyWith(height: 1.6),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Nexa — presence and interaction.
// ---------------------------------------------------------------------------

/// How she sounds and behaves.
class NexaSettingsScreen extends StatelessWidget {
  const NexaSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;
    final repo = state.preferencesRepository;

    return NexaPage(
      title: 'Nexa',
      subtitle: 'How she sounds and behaves.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        NexaSectionLabel('Presence'),
        NexaGroup(
          children: [
            NexaRow(
              label: 'Voice',
              value: repo.voices.firstWhere((v) => v.id == prefs.voiceId).name,
              onTap: () => state.go(NexaScreen.settingsVoice),
            ),
            NexaRow(
              label: 'Appearance',
              value: repo.appearances
                  .firstWhere((a) => a.id == prefs.appearanceId)
                  .name,
              onTap: () => state.go(NexaScreen.settingsAppearance),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Interaction'),
        NexaGroup(
          children: [
            NexaToggleRow(
              label: 'Wake with "Hey Nexa"',
              value: prefs.wakeWord,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(wakeWord: v)),
            ),
            NexaToggleRow(
              label: 'Subtitles',
              note: 'Show what she says as well as speaking it.',
              value: prefs.subtitles,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(subtitles: v)),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Speak first'),
        NexaGroup(
          children: [
            for (final s in SpeakFirst.values)
              _ChoiceRow(
                label: s.label,
                selected: prefs.speakFirst == s,
                onTap: () =>
                    state.updatePrefs(prefs.copyWith(speakFirst: s)),
              ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Nexa is quiet by default. This is how readily she starts a '
          'conversation you did not.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Voice.
// ---------------------------------------------------------------------------

/// How Nexa sounds when she speaks.
class VoiceSettingsScreen extends StatefulWidget {
  const VoiceSettingsScreen({super.key});

  @override
  State<VoiceSettingsScreen> createState() => _VoiceSettingsScreenState();
}

class _VoiceSettingsScreenState extends State<VoiceSettingsScreen> {
  /// Which voice is previewing right now, if any. Local only — there is no
  /// speech service attached, so the UI says "preview unavailable" rather
  /// than pretending a sound played.
  String? _previewing;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;
    final voices = state.preferencesRepository.voices;

    return NexaPage(
      title: 'Voice',
      subtitle: 'How Nexa sounds when she speaks.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        for (var i = 0; i < voices.length; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          _VoiceCard(
            name: voices[i].name,
            note: voices[i].note,
            selected: voices[i].id == prefs.voiceId,
            previewing: _previewing == voices[i].id,
            onSelect: () =>
                state.updatePrefs(prefs.copyWith(voiceId: voices[i].id)),
            onPreview: () => setState(
              () => _previewing =
                  _previewing == voices[i].id ? null : voices[i].id,
            ),
          ),
        ],
        const SizedBox(height: 18),
        Text(
          'Voice carries across every device Nexa is on.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
        if (_previewing != null) ...[
          const SizedBox(height: 14),
          NexaGlassSurface(
            blur: 14,
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            child: Text(
              'Preview needs a connection to Nexa. It will play here once '
              'the voice service is reachable.',
              style: NexaType.body(size: 12.5, color: c.ink45)
                  .copyWith(height: 1.6),
            ),
          ),
        ],
      ],
    );
  }
}

class _VoiceCard extends StatelessWidget {
  const _VoiceCard({
    required this.name,
    required this.note,
    required this.selected,
    required this.previewing,
    required this.onSelect,
    required this.onPreview,
  });

  final String name;
  final String note;
  final bool selected;
  final bool previewing;
  final VoidCallback onSelect;
  final VoidCallback onPreview;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassCard(
      onTap: onSelect,
      blur: 12,
      padding: const EdgeInsets.fromLTRB(20, 18, 14, 18),
      tint: selected ? const Color(0x1C4ADE9B) : null,
      borderColor: selected ? c.emeraldBorder : c.glassBorder,
      child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: NexaType.ui(
                      size: 17,
                      color: selected
                          ? c.emeraldBright
                          : c.ink86,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    note,
                    style: NexaType.ui(size: 12.5, color: c.ink36),
                  ),
                ],
              ),
            ),
            NexaPressable(
              onTap: onPreview,
              scale: 0.92,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 9,
                ),
                decoration: BoxDecoration(
                  borderRadius: NexaRadius.pillAll,
                  border: Border.all(
                    color: previewing
                        ? c.emeraldBorder
                        : c.glassBorder,
                    width: 1,
                  ),
                ),
                child: Text(
                  previewing ? 'Playing' : 'Preview',
                  style: NexaType.ui(
                    size: 12,
                    color: previewing
                        ? c.emeraldBright
                        : c.ink45,
                  ),
                ),
              ),
            ),
          ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Appearance.
// ---------------------------------------------------------------------------

/// The material the mark is cast in.
///
/// Appearance in Nexa is not a colour theme for the interface — the interface
/// is always near-black. It is which material her presence is made of.
class AppearanceSettingsScreen extends StatelessWidget {
  const AppearanceSettingsScreen({super.key});

  static const _materials = <String, NexaMarkMaterial>{
    'emerald': NexaMarkMaterial.emerald,
    'silver': NexaMarkMaterial.silver,
    'graphite': NexaMarkMaterial.graphite,
    'stealth': NexaMarkMaterial.stealthBlack,
  };

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;
    final options = state.preferencesRepository.appearances;
    final current = _materials[prefs.appearanceId] ?? NexaMarkMaterial.emerald;

    return NexaPage(
      title: 'Appearance',
      subtitle: 'The room she is in, and what she is made of.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        SizedBox(
          height: 190,
          child: Center(
            child: NexaMark(
              key: ValueKey(prefs.appearanceId),
              size: 150,
              material: current,
              glow: current == NexaMarkMaterial.emerald ? 52 : 26,
              glowOpacity: current == NexaMarkMaterial.emerald ? 0.45 : 0.2,
              float: const Duration(seconds: 13),
            ),
          ),
        ),
        const SizedBox(height: 18),
        NexaSectionLabel('Theme'),
        NexaGroup(
          children: [
            for (final t in ThemeChoice.values)
              _ChoiceRow(
                label: t.label,
                note: t.note,
                selected: t == prefs.theme,
                onTap: () => state.updatePrefs(prefs.copyWith(theme: t)),
              ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Material'),
        NexaGroup(
          children: [
            for (final o in options)
              _ChoiceRow(
                label: o.name,
                note: o.note,
                selected: o.id == prefs.appearanceId,
                onTap: () =>
                    state.updatePrefs(prefs.copyWith(appearanceId: o.id)),
              ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Motion'),
        NexaGroup(
          children: [
            NexaToggleRow(
              icon: NexaIcon.theme,
              label: 'Reduced motion',
              note: 'Nexa still breathes, but nothing drifts or travels.',
              value: prefs.reducedMotion,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(reducedMotion: v)),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Theme changes the room. Material changes her — the mark is cast in '
          'the same thing on every device you sign in to.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Notifications.
// ---------------------------------------------------------------------------

/// When Nexa may reach for your attention.
class NotificationSettingsScreen extends StatelessWidget {
  const NotificationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;

    return NexaPage(
      title: 'Notifications',
      subtitle: 'When Nexa may reach for your attention.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        NexaGroup(
          children: [
            NexaToggleRow(
              icon: NexaIcon.memory,
              label: 'Something remembered',
              note: 'When she keeps something that matters.',
              value: prefs.notifyMemory,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(notifyMemory: v)),
            ),
            NexaToggleRow(
              icon: NexaIcon.devices,
              label: 'Device activity',
              note: 'Pairing, disconnection, a new sign-in.',
              value: prefs.notifyDevices,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(notifyDevices: v)),
            ),
            NexaToggleRow(
              icon: NexaIcon.assistant,
              label: 'New in Nexa',
              note: 'When she arrives on a device you own.',
              value: prefs.notifyProduct,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(notifyProduct: v)),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Nexa does not send anything else. She has nothing to sell you.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Memory controls.
// ---------------------------------------------------------------------------

/// What she keeps, and what she forgets.
class MemorySettingsScreen extends StatefulWidget {
  const MemorySettingsScreen({super.key});

  @override
  State<MemorySettingsScreen> createState() => _MemorySettingsScreenState();
}

class _MemorySettingsScreenState extends State<MemorySettingsScreen> {
  bool _confirming = false;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;
    final count = state.memoryRepository.count;

    return NexaPage(
      title: 'Memory',
      subtitle: 'What she keeps, and what she forgets.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        NexaSectionLabel('Controls'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.memory,
              label: 'What Nexa remembers',
              value: '$count kept',
              onTap: () => state.goTab(NexaTab.memory),
            ),
            NexaToggleRow(
              icon: NexaIcon.data,
              label: 'Remember new things',
              note: 'When off, she answers but keeps nothing new.',
              value: prefs.rememberNewThings,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(rememberNewThings: v)),
            ),
            NexaToggleRow(
              icon: NexaIcon.profile,
              label: 'Remember people',
              note: 'Names and relationships you mention.',
              value: prefs.rememberPeople,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(rememberPeople: v)),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Clear'),
        if (_confirming)
          _DangerConfirm(
            title: 'Forget everything?',
            body:
                'All $count things Nexa keeps about you, on every device. '
                'She cannot bring any of it back.',
            confirmLabel: 'Forget everything',
            onConfirm: () {
              state.forgetAllMemories();
              setState(() => _confirming = false);
            },
            onCancel: () => setState(() => _confirming = false),
          )
        else
          NexaGroup(
            children: [
              NexaRow(
                icon: NexaIcon.memory,
                label: 'Forget a memory',
                onTap: () => state.goTab(NexaTab.memory),
              ),
              NexaRow(
                icon: NexaIcon.data,
                label: 'Forget everything',
                danger: true,
                onTap: () => setState(() => _confirming = true),
              ),
            ],
          ),

        const SizedBox(height: 14),
        Text(
          'Ask Nexa to forget something at any time and she will, on every '
          'device.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Privacy.
// ---------------------------------------------------------------------------

/// You decide what Nexa can use.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final prefs = state.prefs;

    return NexaPage(
      title: 'Privacy',
      subtitle: 'You decide what Nexa can use.',
      onBack: () => state.back(fallback: NexaScreen.settings),
      children: [
        NexaSectionLabel('Data'),
        NexaGroup(
          children: [
            NexaToggleRow(
              icon: NexaIcon.memory,
              label: 'Keep conversations',
              note: 'Kept on your account so she can refer back to them.',
              value: prefs.conversationHistory,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(conversationHistory: v)),
            ),
            NexaToggleRow(
              icon: NexaIcon.voice,
              label: 'Store voice recordings',
              note: 'Off by default. Nexa works from the words, not the audio.',
              value: prefs.storeVoiceRecordings,
              onChanged: (v) =>
                  state.updatePrefs(prefs.copyWith(storeVoiceRecordings: v)),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Nexa Vision'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.devices,
              label: 'What Nexa can see',
              value: 'Headset only',
              note:
                  'Vision belongs to supported headsets, and only while you '
                  'are wearing one. Your phone is voice only.',
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Your data'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.data,
              label: 'Download your data',
              value: 'Not available yet',
            ),
            NexaRow(
              icon: NexaIcon.memory,
              label: 'Memory controls',
              onTap: () => state.go(NexaScreen.settingsMemory),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Export needs a connection to your account. It will appear here '
          'once that exists.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Account.
// ---------------------------------------------------------------------------

/// Who the account belongs to.
class AccountScreen extends StatelessWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return NexaPage(
      title: 'Profile',
      subtitle: 'Who Nexa thinks you are.',
      onBack: () => state.back(fallback: NexaScreen.profile),
      children: [
        if (state.firstName.isEmpty || state.username.isEmpty) ...[
          NexaEmeraldButton(
            label: 'Complete your profile',
            onTap: () => state.go(NexaScreen.meeting),
          ),
          const SizedBox(height: 22),
        ],
        NexaSectionLabel('Identity'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.profile,
              label: 'Name',
              value: state.firstName.isEmpty ? 'Not set' : state.firstName,
              note: 'What Nexa calls you.',
            ),
            NexaRow(
              icon: NexaIcon.account,
              label: 'Username',
              value: state.username.isEmpty ? 'Not set' : '@${state.username}',
            ),
            NexaRow(icon: NexaIcon.connectedApps, label: 'Email', value: state.email),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Nexa'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.memory,
              label: 'Memories kept',
              value: '${state.memoryRepository.count}',
              onTap: () => state.goTab(NexaTab.memory),
            ),
            NexaRow(
              icon: NexaIcon.devices,
              label: 'Devices paired',
              value: '${state.deviceRepository.mine().length}',
              onTap: () => state.goTab(NexaTab.devices),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Security',
              onTap: () => state.go(NexaScreen.security),
            ),
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Privacy',
              onTap: () => state.go(NexaScreen.privacy),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Changing your name or email needs a connection to your account.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Security.
// ---------------------------------------------------------------------------

/// How you prove it is you.
///
/// Nexa's identity ecosystem is Google, Apple, Meta, phone and passkey. This
/// screen reports which are on the account; changing them needs the account
/// service, so nothing here pretends to alter a credential.
class SecurityScreen extends StatelessWidget {
  const SecurityScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    // Email is reported from the real, verifiable session — not from
    // `preferencesRepository`, which has no way to know how an account
    // authenticated. Every other method stays whatever that repository
    // says, which is honestly "not added" until one of them is real too.
    final active = {
      if (state.authSession.isSignedIn) SignInMethod.email,
      ...state.preferencesRepository.activeSignInMethods,
    };
    final devices = state.deviceRepository.mine().length;

    return NexaPage(
      title: 'Security',
      subtitle: 'How you prove it is you.',
      onBack: () => state.back(fallback: NexaScreen.profile),
      children: [
        NexaSectionLabel('Sign-in methods'),
        NexaGroup(
          children: [
            for (final m in SignInMethod.values)
              NexaRow(
                icon: NexaIcon.privacy,
                label: m.label,
                value: active.contains(m) ? 'On this account' : 'Not added',
                trailing: active.contains(m)
                    ? const _OnBadge()
                    : Text(
                        'Not added',
                        style: NexaType.ui(
                          size: 12.5,
                          color: c.ink30,
                        ),
                      ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'A passkey is the strongest of these — your device proves it is you '
          'and Nexa never stores a password.',
          style: NexaType.body(size: 12.5, color: c.ink36)
              .copyWith(height: 1.6),
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Sessions'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.devices,
              label: 'Signed in on',
              value: '$devices devices',
              onTap: () => state.goTab(NexaTab.devices),
            ),
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Two-step verification',
              value: 'Off',
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaSectionLabel('Account'),
        NexaGroup(
          children: [
            NexaRow(icon: NexaIcon.data, label: 'Delete account', danger: true),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          'Adding a sign-in method, turning on two-step, and deleting an '
          'account all need a connection to your account. They are shown here '
          'so the shape is right, and will work once that exists.',
          style: NexaType.body(size: 12.5, color: c.ink30)
              .copyWith(height: 1.6),
        ),
      ],
    );
  }
}

class _OnBadge extends StatelessWidget {
  const _OnBadge();

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
      decoration: BoxDecoration(
        color: c.emeraldWash,
        borderRadius: NexaRadius.pillAll,
        border: Border.all(color: c.emeraldBorder, width: 1),
      ),
      child: Text(
        'Active',
        style: NexaType.ui(size: 11.5, color: c.emeraldBright),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// About.
// ---------------------------------------------------------------------------

/// Intentionally simple.
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return NexaAtmosphere(
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 46, 30, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: NexaBackButton(
                  onTap: () => state.back(fallback: NexaScreen.profile),
                  size: 20,
                ),
              ),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const NexaMark(
                      size: 128,
                      glow: 46,
                      glowOpacity: 0.4,
                      float: Duration(seconds: 14),
                    ),
                    const SizedBox(height: 40),
                    Text(
                      'NEXA',
                      style: NexaType.brand(size: 16, tracking: 0.52),
                    ),
                    const SizedBox(height: 18),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 260),
                      child: Text(
                        'An AI companion that lives in your real environment.',
                        textAlign: TextAlign.center,
                        style: NexaType.body(
                          size: 14.5,
                          color: c.ink50,
                        ).copyWith(height: 1.6),
                      ),
                    ),
                  ],
                ),
              ),
              NexaGroup(
                children: [
                  NexaRow(label: 'Version', value: '0.1.0'),
                  NexaRow(label: 'Terms'),
                  NexaRow(label: 'Privacy notice'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared pieces.
// ---------------------------------------------------------------------------

/// A row that picks one of a set — a tick rather than a control.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({
    required this.label,
    required this.selected,
    required this.onTap,
    this.note,
  });

  final String label;
  final String? note;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.995,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: NexaType.ui(
                      size: 14.5,
                      color: selected
                          ? c.emeraldBright
                          : c.ink86,
                    ),
                  ),
                  if (note != null) ...[
                    const SizedBox(height: 5),
                    Text(
                      note!,
                      style: NexaType.body(
                        size: 12,
                        color: c.ink36,
                      ).copyWith(height: 1.5),
                    ),
                  ],
                ],
              ),
            ),
            if (selected)
              Text(
                '✓',
                style: NexaType.ui(size: 15, color: c.emerald),
              ),
          ],
        ),
      ),
    );
  }
}

/// The shape a destructive action takes before it happens.
class _DangerConfirm extends StatelessWidget {
  const _DangerConfirm({
    required this.title,
    required this.body,
    required this.confirmLabel,
    required this.onConfirm,
    required this.onCancel,
  });

  final String title;
  final String body;
  final String confirmLabel;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassSurface(
      blur: 14,
      tint: const Color(0x1AF0A08A),
      borderColor: const Color(0x33F0A08A),
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: NexaType.ui(size: 16, color: c.ink)),
          const SizedBox(height: 8),
          Text(
            body,
            style: NexaType.body(size: 13, color: c.ink50)
                .copyWith(height: 1.55),
          ),
          const SizedBox(height: 16),
          NexaPressable(
            onTap: onConfirm,
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 15),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0x24F0A08A),
                borderRadius: NexaRadius.pillAll,
                border: Border.all(color: const Color(0x5CF0A08A), width: 1),
              ),
              child: Text(
                confirmLabel,
                style: NexaType.ui(
                  size: 14.5,
                  weight: FontWeight.w500,
                  color: c.danger,
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          NexaQuietButton(
            label: 'Cancel',
            padding: 13,
            size: 13.5,
            color: c.ink50,
            onTap: onCancel,
          ),
        ],
      ),
    );
  }
}
