import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../theme/nexa_theme.dart';
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
    final voice = state.preferencesRepository.voices
        .firstWhere((v) => v.id == state.prefs.voiceId)
        .name;

    return NexaPage(
      title: 'You',
      children: [
        Row(
          children: [
            Container(
              width: 66,
              height: 66,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: c.surfaceLift,
                shape: BoxShape.circle,
                border: Border.all(color: c.hairlineStrong, width: 1),
              ),
              child: Text(
                (first.isEmpty ? 'N' : first[0]).toUpperCase(),
                style: NexaType.ui(size: 24, color: c.ink72),
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
                  Text(
                    state.email,
                    style: NexaType.ui(size: 13, color: c.ink40),
                  ),
                ],
              ),
            ),
          ],
        ),

        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [c.emeraldWash, c.card.withValues(alpha: c.isDark ? 0.4 : 0.0)],
            ),
            borderRadius: NexaRadius.glassAll,
            border: Border.all(color: c.emeraldBorder, width: 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'YOU AND NEXA',
                style: NexaType.label(size: 10, color: c.ink36),
              ),
              const SizedBox(height: 12),
              Text(
                first.isEmpty
                    ? 'Nexa is just getting to know you.'
                    : 'Nexa has known you since today.',
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
              label: 'Voice',
              value: voice,
              onTap: () => state.go(NexaScreen.settingsVoice),
            ),
            NexaRow(
              label: 'Appearance',
              value: state.preferencesRepository.appearances
                  .firstWhere((a) => a.id == state.prefs.appearanceId)
                  .name,
              onTap: () => state.go(NexaScreen.settingsAppearance),
            ),
            NexaRow(
              label: 'Memory',
              value: '$memories kept',
              onTap: () => state.go(NexaScreen.settingsMemory),
            ),
            NexaRow(
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
              label: 'Profile',
              value: state.displayName,
              onTap: () => state.go(NexaScreen.account),
            ),
            NexaRow(
              label: 'Notifications',
              onTap: () => state.go(NexaScreen.settingsNotifications),
            ),
            NexaRow(
              label: 'Privacy',
              onTap: () => state.go(NexaScreen.privacy),
            ),
            NexaRow(
              label: 'Security',
              onTap: () => state.go(NexaScreen.security),
            ),
          ],
        ),

        const SizedBox(height: 22),
        NexaGroup(
          children: [
            NexaRow(
              label: 'Settings',
              onTap: () => state.go(NexaScreen.settings),
            ),
            NexaRow(
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
