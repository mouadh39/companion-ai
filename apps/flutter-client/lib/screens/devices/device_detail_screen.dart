import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/device.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/device_visual.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_page.dart';

/// One device, in full.
///
/// Everything here comes from the device model — the hero, the capability
/// table, the facts, and which action is offered — so a new product is a new
/// entry in the catalogue, not a new screen.
class DeviceDetailScreen extends StatelessWidget {
  const DeviceDetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final id = state.deviceId;
    final device = id == null ? null : state.deviceRepository.byId(id);

    if (device == null) {
      return NexaPage(
        title: 'Device',
        onBack: () => state.back(fallback: NexaScreen.devices),
        children: [
          Text(
            'This device is no longer on your account.',
            style: NexaType.body(size: 14.5, color: c.ink45),
          ),
        ],
      );
    }

    final soon = device.status == DeviceStatus.comingSoon;

    return DecoratedBox(
      decoration: BoxDecoration(color: c.void_),
      child: SafeArea(
        bottom: false,
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            // Hero.
            SizedBox(
              height: 320,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: DeviceVisual(
                      device: device,
                      glow: soon ? 0.08 : 0.2,
                      padding: 44,
                      driftSeconds: 16,
                    ),
                  ),
                  Positioned(
                    left: 22,
                    top: 8,
                    child: _RoundBack(
                      onTap: () =>
                          state.back(fallback: NexaScreen.devices),
                    ),
                  ),
                ],
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(30, 0, 30, 130),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  DeviceStatusLine(status: device.status),
                  const SizedBox(height: 14),
                  Text(
                    device.name,
                    style: NexaType.display(size: 31).copyWith(height: 1.14),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    device.kind.label,
                    style: NexaType.ui(size: 13, color: c.ink36),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    device.blurb,
                    style: NexaType.body(size: 14.5, color: c.ink50)
                        .copyWith(height: 1.6),
                  ),

                  const SizedBox(height: 28),
                  NexaSectionLabel(device.capabilityLabel),
                  NexaGroup(
                    children: [
                      for (final c in device.capabilities)
                        NexaRow(
                          label: c.label,
                          value: c.note,
                        ),
                    ],
                  ),

                  if (device.facts.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    NexaSectionLabel('Device information'),
                    NexaGroup(
                      children: [
                        for (final f in device.facts)
                          NexaRow(label: f.label, value: f.value),
                      ],
                    ),
                  ],

                  const SizedBox(height: 28),
                  if (device.status.isPaired) ...[
                    NexaSectionLabel('Manage'),
                    const SizedBox(height: 2),
                  ],
                  _PrimaryAction(device: device),

                  if (device.secondaryAction != null) ...[
                    const SizedBox(height: 11),
                    NexaQuietButton(
                      label: device.secondaryAction!,
                      padding: 14,
                      size: 13.5,
                      color: c.ink42,
                      onTap: () {
                        state.forgetDevice(device.id);
                        state.back(fallback: NexaScreen.devices);
                      },
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The one action this device offers, in the weight its status deserves.
class _PrimaryAction extends StatelessWidget {
  const _PrimaryAction({required this.device});

  final NexaDevice device;

  @override
  Widget build(BuildContext context) {
    final state = NexaScope.of(context);

    return switch (device.status) {
      DeviceStatus.available => NexaPrimaryButton(
        label: 'Pair device',
        onTap: () => state.startPairing(device.id),
      ),
      DeviceStatus.comingSoon => NexaOutlineButton(
        label: 'Notify me',
        onTap: () => state.back(fallback: NexaScreen.devices),
      ),
      DeviceStatus.disconnected => NexaPrimaryButton(
        label: 'Reconnect',
        onTap: () => state.goTab(NexaTab.nexa),
      ),
      _ => NexaPrimaryButton(
        label: device.primaryAction,
        onTap: () => state.goTab(NexaTab.nexa),
      ),
    };
  }
}

class _RoundBack extends StatelessWidget {
  const _RoundBack({required this.onTap});

  final VoidCallback onTap;

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
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: c.glassFill,
              shape: BoxShape.circle,
              border: Border.all(color: c.glassBorder, width: 1),
            ),
            child: Text(
              '←',
              style: NexaType.ui(size: 18, color: c.ink72),
            ),
          ),
        ),
      ),
    );
  }
}
