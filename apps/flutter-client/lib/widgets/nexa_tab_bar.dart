import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import 'nexa_controls.dart';

/// The four places the app goes.
///
/// It floats over the content on glass rather than sitting in a bar, and it
/// leaves entirely during onboarding and pairing — those flows own the whole
/// screen.
class NexaTabBar extends StatelessWidget {
  const NexaTabBar({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final active = state.activeTab;

    return Positioned(
      left: 22,
      right: 22,
      bottom: 26,
      child: ClipRRect(
        borderRadius: NexaRadius.pillAll,
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: c.chrome,
              borderRadius: NexaRadius.pillAll,
              border: Border.all(color: c.hairlineStrong, width: 1),
              boxShadow: c.shadow,
            ),
            child: Row(
              children: [
                for (var i = 0; i < NexaTab.values.length; i++) ...[
                  if (i > 0) const SizedBox(width: 4),
                  Expanded(
                    child: _Tab(
                      label: NexaTab.values[i].label,
                      active: NexaTab.values[i] == active,
                      onTap: () => state.goTab(NexaTab.values[i]),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.label, required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.94,
      child: AnimatedContainer(
        duration: NexaMotion.fast,
        curve: NexaMotion.enter,
        // 13 rather than 12: at 12 the tab measured 42 tall, and 44 is the
        // smallest thing a thumb should be asked to hit.
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 6),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? c.emeraldWash : const Color(0x00000000),
          borderRadius: NexaRadius.pillAll,
        ),
        child: Text(
          label,
          style: NexaType.ui(
            size: 12.5,
            weight: FontWeight.w500,
            color: active ? c.emeraldBright : c.ink50,
          ),
        ),
      ),
    );
  }
}
