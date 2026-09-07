import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_glass.dart';
import '../../widgets/nexa_page.dart';

/// One thing Nexa remembers, and what the user can do about it.
///
/// Forgetting is the point of this screen, so it is offered plainly — but
/// behind a confirmation, because it cannot be undone.
class MemoryDetailScreen extends StatefulWidget {
  const MemoryDetailScreen({super.key});

  @override
  State<MemoryDetailScreen> createState() => _MemoryDetailScreenState();
}

class _MemoryDetailScreenState extends State<MemoryDetailScreen> {
  bool _confirming = false;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final id = state.memoryId;
    final entry = id == null ? null : state.memoryRepository.byId(id);

    if (entry == null) {
      // The entry was forgotten while this screen was open.
      return NexaPage(
        title: 'Memory',
        onBack: () => state.back(fallback: NexaScreen.memory),
        children: [
          Text(
            'This is no longer kept.',
            style: NexaType.body(size: 14.5, color: c.ink45),
          ),
        ],
      );
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -1),
          radius: 1.1,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.68],
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 46, 30, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: NexaBackButton(
                  onTap: () => state.back(fallback: NexaScreen.memory),
                  size: 20,
                ),
              ),
              const SizedBox(height: 24),
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.kind.label.toUpperCase(),
                        style: NexaType.label(
                          size: 11,
                          tracking: 0.22,
                          color: c.emerald,
                          weight: FontWeight.w400,
                        ),
                      ),
                      const SizedBox(height: 16),
                      Text(
                        entry.text,
                        style:
                            NexaType.display(size: 26).copyWith(height: 1.34),
                      ),
                      const SizedBox(height: 20),
                      Row(
                        children: [
                          NexaStatusDot(
                            color: entry.important
                                ? c.emerald
                                : c.ink30,
                            glow: entry.important,
                          ),
                          const SizedBox(width: 9),
                          Expanded(
                            child: Text(
                              'Remembered ${entry.when} · ${entry.source}',
                              style: NexaType.ui(
                                size: 13,
                                color: c.ink36,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 26),
                      NexaGlassSurface(
                        blur: 16,
                        padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                        child: Text(
                          entry.important
                              ? 'Nexa weights this heavily. It shapes how she answers '
                                  'even when you do not mention it.'
                              : 'Nexa uses this to understand you. Correct it and she '
                                  'follows the correction, not the original.',
                          style: NexaType.body(
                                  size: 13.5, color: c.ink50)
                              .copyWith(height: 1.6),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 20),
              if (_confirming)
                _ConfirmForget(
                  onCancel: () => setState(() => _confirming = false),
                  onForget: () => state.forgetMemory(entry.id),
                )
              else ...[
                NexaOutlineButton(
                  label: 'Correct this',
                  onTap: () => state.goTab(NexaTab.nexa),
                ),
                const SizedBox(height: 11),
                NexaQuietButton(
                  label: 'Forget this',
                  padding: 15,
                  size: 13.5,
                  color: c.ink42,
                  onTap: () => setState(() => _confirming = true),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Forgetting cannot be undone, so it asks once.
class _ConfirmForget extends StatelessWidget {
  const _ConfirmForget({required this.onCancel, required this.onForget});

  final VoidCallback onCancel;
  final VoidCallback onForget;

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
          Text(
            'Forget this for good?',
            style: NexaType.ui(size: 16, color: c.ink),
          ),
          const SizedBox(height: 8),
          Text(
            'She will not be able to bring it back, on any device.',
            style: NexaType.body(size: 13, color: c.ink50)
                .copyWith(height: 1.55),
          ),
          const SizedBox(height: 16),
          NexaPressable(
            onTap: onForget,
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 15),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: const Color(0x24F0A08A),
                borderRadius: NexaRadius.pillAll,
                border: Border.all(color: const Color(0x5CF0A08A), width: 1),
              ),
              child: Text(
                'Forget it',
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
            label: 'Keep it',
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
