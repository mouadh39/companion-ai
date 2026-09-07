import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import '../widgets/nexa_controls.dart';
import '../widgets/nexa_mark.dart';
import '../widgets/nexa_wordmark.dart';

/// The first screen. Centred presence: the mark is the whole composition, and
/// the copy underneath says only what it has to.
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.28),
          radius: 0.86,
          colors: [c.groundTop, c.base, c.void_],
          stops: [0.0, 0.58, 1.0],
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Align(
            alignment: Alignment(0, -0.24),
            child: NexaHalo(size: 520, opacity: 0.17),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(34, 64, 34, 46),
              child: Column(
                children: [
                  const NexaRiseIn(child: NexaWordmark()),
                  const Expanded(
                    child: Center(
                      child: NexaMark(
                        size: 232,
                        glow: 58,
                        glowOpacity: 0.3,
                        float: Duration(seconds: 12),
                      ),
                    ),
                  ),
                  NexaRiseIn(
                    delay: const Duration(milliseconds: 300),
                    child: Column(
                      children: [
                        Text(
                          "Explore what's next.",
                          textAlign: TextAlign.center,
                          style: NexaType.display(size: 32),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'A new kind of AI companion.',
                          textAlign: TextAlign.center,
                          style: NexaType.body(
                            size: 15,
                            color: c.ink50,
                          ).copyWith(height: 1.5),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 44),
                  NexaRiseIn(
                    delay: const Duration(milliseconds: 500),
                    child: Column(
                      children: [
                        NexaPrimaryButton(
                          label: 'Get started',
                          trailing: '→',
                          onTap: () => state.go(NexaScreen.signup),
                        ),
                        const SizedBox(height: 12),
                        NexaQuietButton(
                          label: 'I already have an account',
                          onTap: () => state.go(NexaScreen.login),
                        ),
                      ],
                    ),
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
