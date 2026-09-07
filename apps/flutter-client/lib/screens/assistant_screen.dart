import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import '../widgets/nexa_controls.dart';
import '../widgets/nexa_glass.dart';
import '../widgets/nexa_icons.dart';
import '../widgets/nexa_mark.dart';
import '../widgets/nexa_page.dart';

/// The home screen, and the argument the whole design makes: there is no chat
/// log and no waveform. The mark is the interface. Its size, glow and tempo
/// are the only things that say whether Nexa is idle, listening or speaking.
class AssistantScreen extends StatelessWidget {
  const AssistantScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final listening = state.screen == NexaScreen.listening;
    final speaking = state.screen == NexaScreen.speaking;
    final live = listening || speaking;
    final first = state.firstName;

    final greeting = listening
        ? 'Listening'
        : speaking
        ? 'Nexa'
        : (first.isEmpty ? 'Hello' : 'Hello, $first');

    final presenceLine = listening
        ? 'Go ahead'
        : speaking
        ? 'Speaking'
        : 'Nexa is here';

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.4),
          radius: 0.88,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.72],
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Two quiet, static blooms far off the mark's own halo — the
          // atmosphere that keeps the screen reading as a lit space rather
          // than the mark floating on a flat panel.
          Positioned(
            top: -80,
            left: -60,
            child: IgnorePointer(
              child: Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      c.emerald.withValues(alpha: c.isDark ? 0.06 : 0.09),
                      c.emerald.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            bottom: -100,
            right: -70,
            child: IgnorePointer(
              child: Container(
                width: 300,
                height: 300,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      c.emerald.withValues(alpha: c.isDark ? 0.05 : 0.07),
                      c.emerald.withValues(alpha: 0),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Align(
            alignment: const Alignment(0, -0.32),
            child: NexaHalo(
              size: 460,
              opacity: live ? 0.15 : 0.1,
              period: speaking
                  ? const Duration(milliseconds: 2600)
                  : const Duration(seconds: 9),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(28, 56, 28, 116),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              greeting.toUpperCase(),
                              style: NexaType.label(
                                size: 11,
                                color: c.ink32,
                                weight: FontWeight.w400,
                              ),
                            ),
                            const SizedBox(height: 7),
                            Text(
                              presenceLine,
                              style: NexaType.display(size: 22),
                            ),
                          ],
                        ),
                      ),
                      _RoundIconButton(
                        icon: NexaIcon.profile,
                        onTap: () => state.goTab(NexaTab.you),
                      ),
                    ],
                  ),
                  Expanded(
                    child: Center(
                      child: SizedBox(
                        width: 250,
                        height: 250,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            if (listening) const NexaListeningRing(size: 250),
                            // The three presence states differ only in scale,
                            // bloom and tempo — never in form.
                            AnimatedSize(
                              duration: const Duration(milliseconds: 800),
                              curve: NexaMotion.curve,
                              child: NexaMark(
                                size: listening
                                    ? 176
                                    : speaking
                                    ? 184
                                    : 162,
                                glow: listening
                                    ? 78
                                    : speaking
                                    ? 86
                                    : 54,
                                glowOpacity: 0.5,
                                breathe: listening
                                    ? NexaMotion.breatheListening
                                    : speaking
                                    ? NexaMotion.breatheSpeaking
                                    : NexaMotion.breatheIdle,
                                float: NexaMotion.float,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  // Who has the turn (a bordered emerald pill with a live
                  // dot) while Nexa is live; a quiet "tap to speak" hint when
                  // she is idle. There is no real transcript to show yet —
                  // speech and a turn pipeline are not wired client-side —
                  // and this screen's design is built around not needing one.
                  SizedBox(
                    height: 24,
                    child: Center(
                      child: live
                          ? Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 13,
                                vertical: 5,
                              ),
                              decoration: BoxDecoration(
                                color: c.emeraldWash,
                                borderRadius: NexaRadius.pillAll,
                                border: Border.all(
                                  color: c.emeraldBorder,
                                  width: 1,
                                ),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  NexaStatusDot(color: c.emerald),
                                  const SizedBox(width: 8),
                                  Text(
                                    listening ? 'YOU' : 'NEXA',
                                    style: NexaType.label(
                                      size: 10,
                                      color: c.emeraldBright,
                                    ),
                                  ),
                                ],
                              ),
                            )
                          : Text(
                              'TAP TO SPEAK',
                              style: NexaType.label(
                                size: 11,
                                tracking: 0.16,
                                color: c.ink32,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      Expanded(
                        child: NexaGlassCard(
                          onTap: () => state.goTab(NexaTab.memory),
                          blur: 14,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 18,
                            vertical: 15,
                          ),
                          child: Text(
                            // Not "Earlier today" — that claimed history
                            // that may not exist yet. This opens Memory
                            // either way, whether it has something to show
                            // or its own empty state. ("Memories" rather
                            // than "Memory" so it reads distinctly from
                            // the tab bar's own label just below it.)
                            'Memories',
                            style: NexaType.ui(
                              size: 14,
                              color: c.ink50,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      _MicButton(live: live, onTap: state.talk),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The one control on the screen. Its dot rounds into a square while Nexa is
/// live, which is the whole affordance — a stop, not a second button.
class _MicButton extends StatelessWidget {
  const _MicButton({required this.live, required this.onTap});

  final bool live;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.94,
      child: AnimatedContainer(
        duration: NexaMotion.medium,
        width: 62,
        height: 62,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: live ? c.emerald.withValues(alpha: 0.22) : c.emerald.withValues(alpha: 0.12),
          shape: BoxShape.circle,
          border: Border.all(
            color: live ? c.emerald.withValues(alpha: 0.55) : c.emeraldBorder,
            width: 1,
          ),
        ),
        child: AnimatedContainer(
          duration: NexaMotion.medium,
          width: 16,
          height: 16,
          decoration: BoxDecoration(
            color: c.emerald,
            borderRadius: BorderRadius.circular(live ? 4 : 999),
            boxShadow: [
              BoxShadow(
                color: c.emerald.withValues(alpha: 0.7),
                blurRadius: 14,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The small circular outline-glyph button in a screen header.
class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, this.onTap});

  final NexaIcon icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.92,
      // The glyph is 38 across, but the target underneath it clears 44.
      child: SizedBox(
        width: 44,
        height: 44,
        child: Center(
          child: NexaGlassSurface(
            radius: BorderRadius.circular(19),
            blur: 12,
            child: SizedBox(
              width: 38,
              height: 38,
              child: Center(
                child: NexaGlyph(icon, size: 17, color: c.ink55),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
