import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/device.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/device_visual.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_mark.dart';
import '../../widgets/nexa_page.dart';

/// Before anything technical happens: this is the device, and this is what is
/// about to occur.
///
/// Pairing in Nexa is an introduction, not a setup wizard — so the device gets
/// the room, the explanation is two sentences, and there is one way forward.
class PairIntroScreen extends StatelessWidget {
  const PairIntroScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final id = state.deviceId;
    final device = id == null ? null : state.deviceRepository.byId(id);

    if (device == null) {
      return NexaPage(
        title: 'Pair device',
        onBack: () => state.back(fallback: NexaScreen.devices),
        children: [
          Text(
            'Choose a device to pair.',
            style: NexaType.body(size: 14.5, color: c.ink45),
          ),
        ],
      );
    }

    final guided = device.requiresGuidedPairing;

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.55),
          radius: 1.0,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.72],
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 46, 30, 40),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: Alignment.centerLeft,
                child: NexaBackButton(
                  onTap: () => state.back(fallback: NexaScreen.devices),
                  size: 20,
                ),
              ),

              Expanded(
                flex: 5,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const NexaHalo(size: 380, opacity: 0.13),
                    DeviceVisual(
                      device: device,
                      glow: 0.18,
                      padding: 20,
                      driftSeconds: 14,
                    ),
                  ],
                ),
              ),

              Text(
                'PAIR',
                style: NexaType.label(
                  size: 11,
                  tracking: 0.22,
                  color: c.emerald,
                  weight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                device.name,
                style: NexaType.display(size: 29).copyWith(height: 1.18),
              ),
              const SizedBox(height: 14),
              Text(
                device.pairingSummary ??
                    'Nexa will be available on this device once it is paired.',
                style: NexaType.body(size: 14.5, color: c.ink50)
                    .copyWith(height: 1.6),
              ),

              const SizedBox(height: 22),
              Row(
                children: [
                  const NexaMark(size: 22, glow: 14, glowOpacity: 0.4),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      guided
                          ? 'About a minute. You can stop at any point.'
                          : 'A few seconds. You can stop at any point.',
                      style: NexaType.ui(
                        size: 12.5,
                        color: c.ink36,
                      ),
                    ),
                  ),
                ],
              ),

              const Spacer(),
              NexaPrimaryButton(
                label: guided ? 'Show me how' : 'Pair device',
                trailing: '→',
                onTap: () {
                  if (guided) {
                    state.beginGuide();
                  } else {
                    // A device that needs no guide pairs from here.
                    state.completePairing();
                  }
                },
              ),
              const SizedBox(height: 14),
              Text(
                _reassurance(device),
                textAlign: TextAlign.center,
                style: NexaType.ui(size: 12.5, color: c.ink30),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _reassurance(NexaDevice device) => device.requiresGuidedPairing
      ? 'Nothing is typed. Your headset shows a code and this phone reads it.'
      : 'Nothing leaves your account.';
}
