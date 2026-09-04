import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/device_visual.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_mark.dart';
import '../../widgets/nexa_page.dart';

/// Pairing is done. The device and the mark, together, once.
class PairSuccessScreen extends StatelessWidget {
  const PairSuccessScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final id = state.deviceId;
    final device = id == null ? null : state.deviceRepository.byId(id);
    final first = state.firstName;
    final owned = device == null
        ? 'Your device'
        : first.isEmpty
        ? 'Your ${device.name}'
        : "$first's ${device.name}";

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0, -0.3),
          radius: 1.0,
          colors: [c.groundTop, c.void_],
          stops: [0.0, 0.72],
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(32, 64, 32, 46),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const NexaHalo(size: 420, opacity: 0.15),
                    if (device != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 18),
                        child: DeviceVisual(
                          device: device,
                          glow: 0.16,
                          padding: 26,
                          driftSeconds: 13,
                        ),
                      ),
                    const Align(
                      alignment: Alignment(0.72, 0.86),
                      child: NexaMark(
                        size: 52,
                        glow: 26,
                        glowOpacity: 0.7,
                        breathe: Duration(seconds: 5),
                      ),
                    ),
                  ],
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  NexaStatusDot(color: c.emerald),
                  const SizedBox(width: 8),
                  Text(
                    'PAIRING COMPLETE',
                    style: NexaType.label(
                      size: 11.5,
                      tracking: 0.2,
                      color: c.emerald,
                      weight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                owned,
                textAlign: TextAlign.center,
                style: NexaType.display(size: 28).copyWith(height: 1.18),
              ),
              const SizedBox(height: 12),
              Text(
                'is now paired with Nexa. Your Nexa is ready.',
                textAlign: TextAlign.center,
                style: NexaType.body(size: 15, color: c.ink48)
                    .copyWith(height: 1.6),
              ),
              const SizedBox(height: 34),
              NexaPrimaryButton(
                label: 'Continue',
                onTap: () => state.goTab(NexaTab.devices),
              ),
              const SizedBox(height: 11),
              NexaQuietButton(
                label: 'Pair another device',
                padding: 14,
                size: 13.5,
                color: c.ink40,
                onTap: () => state.goRoot(NexaScreen.connect),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
