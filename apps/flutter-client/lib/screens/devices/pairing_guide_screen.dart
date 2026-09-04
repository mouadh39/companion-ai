import 'dart:async';

import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/repositories/device_link_service.dart';
import '../../data/repositories/pairing.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import 'tqrcg_code_screen.dart' show NexaStatusDotSmall;

/// One stage of the headset guide.
class _Stage {
  const _Stage({
    required this.title,
    required this.body,
    required this.illustration,
    required this.cta,
    required this.foot,
    this.links = false,
    this.illustrationLinked,
  });

  final String title;
  final String body;
  final String illustration;
  final String cta;
  final String foot;

  /// Whether this stage runs the local link to the headset.
  final bool links;

  /// Shown instead of [illustration] once the phone is connected.
  final String? illustrationLinked;
}

const _stages = <_Stage>[
  _Stage(
    title: 'Put on your headset.',
    body: 'Sit comfortably. Nexa needs about a minute of your attention.',
    illustration: 'assets/devices/nxa-illo-1.webp',
    cta: 'Next',
    foot: 'You can leave and come back.',
  ),
  _Stage(
    title: 'Open Nexa on your headset.',
    body: 'Find Nexa in your library and launch it. Leave it running.',
    illustration: 'assets/devices/nxa-illo-2.webp',
    cta: 'Next',
    foot: 'You can leave and come back.',
  ),
  _Stage(
    title: 'Connect your headset.',
    body: 'Keep Nexa open on your headset while your phone connects to it.',
    // Nexa is still open on the headset while the phone finds it, and the
    // drawing says so until the connection lands. No code appears here — the
    // only code in this flow is the one the phone shows in the last stage.
    illustration: 'assets/devices/nxa-illo-2.webp',
    illustrationLinked: 'assets/devices/nxa-illo-5.webp',
    cta: 'Next',
    foot: 'Keep the headset nearby.',
    // This stage is the local link — the phone finds the headset and opens a
    // connection before there is anything worth showing it.
    links: true,
  ),
  _Stage(
    title: 'Complete pairing with your headset.',
    body: 'Your phone will show a secure pairing code. Look at the code with '
        'your headset to complete pairing.',
    illustration: 'assets/devices/nxa-illo-4.webp',
    cta: 'Show the code',
    foot: 'This phone shows the code — the headset reads it.',
  ),
];

/// The illustrated headset guide.
///
/// Visual first: the drawing is the dominant element and the words underneath
/// only name what it already shows.
class PairingGuideScreen extends StatefulWidget {
  const PairingGuideScreen({super.key});

  @override
  State<PairingGuideScreen> createState() => _PairingGuideScreenState();
}

class _PairingGuideScreenState extends State<PairingGuideScreen> {
  StreamSubscription<PairingProgress>? _sub;

  /// Held directly, because dispose() runs after this element is deactivated
  /// and an inherited-widget lookup there is unsafe.
  DeviceLinkService? _link;
  String _linkMessage = '';

  @override
  void dispose() {
    _sub?.cancel();
    unawaited(_link?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  /// Start looking for the headset. Idempotent: coming back to this stage
  /// from the next one must not throw away a connection already made.
  void _startLink(NexaAppState state) {
    if (_sub != null || state.pairingPhase.isLinked) return;

    final device = state.deviceId == null
        ? null
        : state.deviceRepository.byId(state.deviceId!);

    _link = state.deviceLinkService;
    _sub = _link!
        .link(deviceId: state.deviceId ?? '', deviceName: device?.name)
        .listen((p) {
          if (!mounted) return;
          setState(() => _linkMessage = p.message);
          state.setPairingPhase(p.phase);
        });
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final step = state.pairStep.clamp(0, _stages.length - 1);
    final stage = _stages[step];
    final device = state.deviceId == null
        ? null
        : state.deviceRepository.byId(state.deviceId!);

    // The connecting stage starts the moment it is on screen.
    if (stage.links) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _startLink(state);
      });
    }

    // Nothing may move past the link until the phone is actually connected —
    // there is no point showing a code to a headset it cannot talk to.
    final waitingOnLink = stage.links && !state.pairingPhase.isLinked;
    final illustration = stage.links && state.pairingPhase.isLinked
        ? stage.illustrationLinked ?? stage.illustration
        : stage.illustration;

    void next() {
      if (step == _stages.length - 1) {
        state.go(NexaScreen.pairingCode);
      } else {
        state.setPairStep(step + 1);
      }
    }

    void back() {
      if (step == 0) {
        state.back(fallback: NexaScreen.devices);
      } else {
        state.setPairStep(step - 1);
      }
    }

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.7),
          radius: 1.1,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.7],
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 22, 30, 38),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  NexaBackButton(onTap: back, size: 20),
                  const Spacer(),
                  Text(
                    'STEP ${step + 1} OF ${_stages.length}',
                    style: NexaType.label(
                      size: 11,
                      tracking: 0.16,
                      color: c.ink34,
                      weight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  for (var i = 0; i < _stages.length; i++) ...[
                    if (i > 0) const SizedBox(width: 5),
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

              // The illustration owns the screen.
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  child: _Illustration(
                    key: ValueKey(illustration),
                    asset: illustration,
                  ),
                ),
              ),

              if (device != null) ...[
                Text(
                  'PAIR ${device.name.toUpperCase()}',
                  style: NexaType.label(
                    size: 11,
                    tracking: 0.22,
                    color: c.emerald,
                    weight: FontWeight.w400,
                  ),
                ),
                const SizedBox(height: 12),
              ],
              Text(
                stage.title,
                style: NexaType.display(size: 27).copyWith(height: 1.2),
              ),
              const SizedBox(height: 12),
              Text(
                stage.body,
                style: NexaType.body(size: 14.5, color: c.ink48)
                    .copyWith(height: 1.6),
              ),

              if (stage.links) ...[
                const SizedBox(height: 18),
                _LinkLine(
                  message: _linkMessage.isEmpty
                      ? 'Looking for your headset…'
                      : _linkMessage,
                  connected: state.pairingPhase.isLinked,
                ),
              ],

              const SizedBox(height: 24),
              NexaPrimaryButton(
                label: stage.cta,
                onTap: waitingOnLink ? null : next,
              ),
              const SizedBox(height: 14),
              Text(
                stage.foot,
                textAlign: TextAlign.center,
                style: NexaType.ui(size: 12.5, color: c.ink32),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Where the local connection has got to, in one line.
///
/// The transport underneath is not built yet — see [DeviceLinkService] — so
/// this reports a scripted sequence, not a radio.
class _LinkLine extends StatelessWidget {
  const _LinkLine({required this.message, required this.connected});

  final String message;
  final bool connected;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
      decoration: BoxDecoration(
        color: connected ? c.emeraldWash : c.surfaceQuiet,
        borderRadius: NexaRadius.pillAll,
        border: Border.all(
          color: connected
              ? c.emeraldBorder
              : c.hairlineStrong,
          width: 1,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          NexaStatusDotSmall(
            color: connected ? c.emerald : c.ink42,
            pulse: !connected,
          ),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              message,
              textAlign: TextAlign.center,
              style: NexaType.ui(
                size: 14,
                color: connected ? c.emeraldBright : c.ink72,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The supplied line drawing, recoloured to read on near-black.
///
/// The artwork is dark ink on transparency — drawn for paper. Tinting it
/// through its own alpha keeps every line exactly where the illustrator put
/// it while letting it sit on a Nexa surface.
class _Illustration extends StatelessWidget {
  const _Illustration({super.key, required this.asset});

  final String asset;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Stack(
      alignment: Alignment.center,
      children: [
        // A pool of light behind the drawing, so it is lit rather than pasted.
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              radius: 0.62,
              colors: [
                c.emerald.withValues(alpha: 0.11),
                c.emerald.withValues(alpha: 0),
              ],
            ),
          ),
          child: const SizedBox.expand(),
        ),
        NexaRiseIn(
          key: key,
          distance: 14,
          duration: const Duration(milliseconds: 620),
          child: ColorFiltered(
            colorFilter: const ColorFilter.mode(
              Color(0xFFDCE8E1),
              BlendMode.srcIn,
            ),
            child: Image.asset(
              asset,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.medium,
            ),
          ),
        ),
      ],
    );
  }
}
