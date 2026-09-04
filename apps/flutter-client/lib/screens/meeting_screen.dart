import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';
import '../widgets/nexa_controls.dart';
import '../widgets/nexa_mark.dart';

/// The three beats of the first meeting. Nexa introduces herself, says what
/// she keeps, and then asks for the one thing she needs.
const _beats = <({String kicker, String title, String body})>[
  (
    kicker: 'Hello',
    title: "I'm Nexa.",
    body:
        "Not an app you open — someone you talk to. I listen, I remember what "
        "matters, and I can be present on the devices you already wear.",
  ),
  (
    kicker: 'What I can do',
    title: 'I keep what matters.',
    body:
        "Ask me anything by voice. I hold on to the things you tell me, and "
        "you can see and change every one of them.",
  ),
  (
    kicker: 'Your turn',
    title: 'Who are you?',
    body: "One thing only — the rest I'll learn as we go.",
  ),
];

/// First meeting — the only onboarding Nexa has, and the only place she asks
/// the user for anything.
class MeetingScreen extends StatefulWidget {
  const MeetingScreen({super.key});

  @override
  State<MeetingScreen> createState() => _MeetingScreenState();
}

class _MeetingScreenState extends State<MeetingScreen> {
  final _name = TextEditingController();

  @override
  void initState() {
    super.initState();
    _name.addListener(() {
      // The CTA reads back the name as it is typed, so the screen has to
      // rebuild on every keystroke.
      NexaScope.of(context).setName(_name.text);
    });
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final step = state.meetStep;
    final beat = _beats[step];
    final isLast = step == _beats.length - 1;
    final first = state.firstName;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.4),
          radius: 0.9,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.7],
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Align(
            alignment: Alignment(0, -0.4),
            child: NexaHalo(
              size: 420,
              opacity: 0.15,
              period: Duration(seconds: 9),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(34, 78, 34, 44),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(
                    height: 200,
                    child: Center(
                      child: NexaMark(
                        size: 150,
                        glow: 46,
                        glowOpacity: 0.4,
                        breathe: Duration(seconds: 6),
                        float: Duration(seconds: 12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  // Keyed so the three beats cross-fade rather than snapping.
                  AnimatedSwitcher(
                    duration: NexaMotion.medium,
                    switchInCurve: NexaMotion.enter,
                    child: Column(
                      key: ValueKey(step),
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          beat.kicker.toUpperCase(),
                          style: NexaType.label(
                            size: 11,
                            tracking: 0.22,
                            color: c.emerald,
                            weight: FontWeight.w400,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          beat.title,
                          style: NexaType.display(size: 28)
                              .copyWith(height: 1.22),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          beat.body,
                          style: NexaType.body(
                            size: 15,
                            color: c.ink52,
                          ).copyWith(height: 1.62),
                        ),
                      ],
                    ),
                  ),
                  if (isLast) ...[
                    const SizedBox(height: 26),
                    NexaField(
                      label: 'What should Nexa call you?',
                      controller: _name,
                      hint: 'Alex',
                      autofocus: true,
                      onSubmitted: (_) => _next(state, isLast),
                    ),
                  ],
                  const Spacer(),
                  Row(
                    children: [
                      for (var i = 0; i < _beats.length; i++) ...[
                        if (i > 0) const SizedBox(width: 7),
                        Expanded(
                          child: AnimatedContainer(
                            duration: NexaMotion.slow,
                            curve: NexaMotion.enter,
                            height: 2,
                            decoration: BoxDecoration(
                              color: i <= step
                                  ? c.emerald
                                  : c.glassBorder,
                              borderRadius: BorderRadius.circular(2),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 20),
                  NexaPrimaryButton(
                    label: isLast && first.isNotEmpty
                        ? 'Nice to meet you, $first'
                        : 'Continue',
                    onTap: () => _next(state, isLast),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _next(NexaAppState state, bool isLast) {
    if (isLast) {
      state.go(NexaScreen.assistant);
    } else {
      state.setMeetStep(state.meetStep + 1);
    }
  }
}
