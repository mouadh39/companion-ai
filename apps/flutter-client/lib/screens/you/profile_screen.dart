import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_glass.dart';
import '../../widgets/nexa_icons.dart';
import '../../widgets/nexa_page.dart';

/// You — the root of the fourth destination.
///
/// It opens with the relationship rather than with a list: how long Nexa has
/// known you, and how much she holds. The settings tree hangs beneath it.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final memories = state.memoryRepository.count;
    final devices = state.deviceRepository.mine().length;
    final first = state.firstName;
    final hasProfile = first.isNotEmpty || state.username.isNotEmpty;
    final voice = state.preferencesRepository.voices
        .firstWhere((v) => v.id == state.prefs.voiceId)
        .name;

    return NexaPage(
      title: 'You',
      children: [
        Row(
          children: [
            NexaGlassSurface(
              radius: BorderRadius.circular(33),
              blur: 12,
              child: SizedBox(
                width: 66,
                height: 66,
                child: Center(
                  child: Text(
                    (first.isEmpty ? 'N' : first[0]).toUpperCase(),
                    style: NexaType.ui(size: 24, color: c.ink72),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    state.displayName,
                    style: NexaType.display(size: 24),
                  ),
                  const SizedBox(height: 5),
                  if (hasProfile)
                    Text(
                      state.email,
                      style: NexaType.ui(size: 13, color: c.ink40),
                    )
                  else
                    // No profile saved yet — offer to set one up rather than
                    // showing an empty name. Routes into the real onboarding
                    // flow (first name, date of birth, username).
                    Align(
                      alignment: Alignment.centerLeft,
                      child: NexaPressable(
                        onTap: () => state.go(NexaScreen.meeting),
                        scale: 0.97,
                        child: Container(
                          margin: const EdgeInsets.only(top: 3),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 7,
                          ),
                          decoration: BoxDecoration(
                            color: c.emeraldWash,
                            borderRadius: NexaRadius.pillAll,
                            border:
                                Border.all(color: c.emeraldBorder, width: 1),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Flexible(
                                child: Text(
                                  'Set up your profile',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: NexaType.ui(
                                    size: 12,
                                    weight: FontWeight.w500,
                                    color: c.emeraldBright,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 7),
                              Text(
                                '›',
                                style: NexaType.ui(size: 13, color: c.emerald),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),

        const SizedBox(height: 24),
        NexaGlassSurface(
          blur: 18,
          tint: c.emeraldWash,
          borderColor: c.emeraldBorder,
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'YOU AND NEXA',
                style: NexaType.label(size: 10, color: c.ink36),
              ),
              const SizedBox(height: 12),
              Text(
                // Never a claimed duration — there is no real "first met"
                // date wired to anything client-side yet (see the report:
                // no backend endpoint exposes one), and "since today" was
                // exactly as fabricated as a duration this could not
                // possibly know for an account that existed before now.
                first.isEmpty
                    ? 'Nexa is just getting to know you.'
                    : 'Nexa is getting to know you, $first.',
                style: NexaType.ui(
                  size: 19,
                  color: c.ink,
                  height: 1.34,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  _Stat(value: '$memories', label: 'memories'),
                  const SizedBox(width: 24),
                  _Stat(value: '$devices', label: 'devices'),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 26),
        NexaSectionLabel('Nexa'),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.voice,
              label: 'Voice',
              value: voice,
              onTap: () => state.go(NexaScreen.settingsVoice),
            ),
            NexaRow(
              icon: NexaIcon.theme,
              label: 'Appearance',
              value: state.preferencesRepository.appearances
                  .firstWhere((a) => a.id == state.prefs.appearanceId)
                  .name,
              onTap: () => state.go(NexaScreen.settingsAppearance),
            ),
            NexaRow(
              icon: NexaIcon.memory,
              label: 'Memory',
              value: '$memories kept',
              onTap: () => state.go(NexaScreen.settingsMemory),
            ),
            NexaRow(
              icon: NexaIcon.devices,
              label: 'Devices',
              value: '$devices paired',
              onTap: () => state.goTab(NexaTab.devices),
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
              value: hasProfile ? state.displayName : 'Not set up',
              onTap: () => state.go(NexaScreen.account),
            ),
            NexaRow(
              icon: NexaIcon.notifications,
              label: 'Notifications',
              onTap: () => state.go(NexaScreen.settingsNotifications),
            ),
            NexaRow(
              icon: NexaIcon.privacy,
              label: 'Privacy',
              onTap: () => state.go(NexaScreen.privacy),
            ),
            NexaRow(
              icon: NexaIcon.data,
              label: 'Security',
              onTap: () => state.go(NexaScreen.security),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaGroup(
          children: [
            NexaRow(
              icon: NexaIcon.settings,
              label: 'Settings',
              onTap: () => state.go(NexaScreen.settings),
            ),
            NexaRow(
              icon: NexaIcon.help,
              label: 'About Nexa',
              onTap: () => state.go(NexaScreen.about),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaOutlineButton(
          label: 'Log out',
          danger: true,
          onTap: state.logOut,
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          value,
          style: NexaType.ui(size: 21, color: c.emeraldBright),
        ),
        const SizedBox(height: 3),
        Text(label, style: NexaType.ui(size: 11, color: c.ink36)),
      ],
    );
  }
}
