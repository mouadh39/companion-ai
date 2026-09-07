import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/device.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/device_visual.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_page.dart';

/// The device catalogue — everything Nexa runs on, or is going to.
///
/// Kept separate from the account's own devices on purpose: a hub that mixes
/// what you own with what you could own makes both harder to read. Here the
/// products get the room, because this page is an invitation.
class ConnectScreen extends StatelessWidget {
  const ConnectScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final pairable = state.deviceRepository.pairable();
    final soon = state.deviceRepository.comingSoon();

    return NexaPage(
      title: 'Add a device',
      subtitle: 'Choose where Nexa should live next.',
      onBack: () => state.back(fallback: NexaScreen.devices),
      children: [
        if (pairable.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 44, horizontal: 20),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: NexaRadius.glassAll,
              border: Border.all(color: c.hairline, width: 1),
            ),
            child: Text(
              'Nexa is on everything you own.',
              style: NexaType.body(size: 14, color: c.ink42),
            ),
          )
        else
          for (var i = 0; i < pairable.length; i++) ...[
            if (i > 0) const SizedBox(height: 16),
            NexaRiseIn(
              delay: NexaMotion.stagger * i,
              duration: const Duration(milliseconds: 460),
              distance: 12,
              child: AvailableDeviceCard(
                device: pairable[i],
                onTap: () => state.openDevice(pairable[i].id),
                onPair: () => state.startPairing(pairable[i].id),
              ),
            ),
          ],

        if (soon.isNotEmpty) ...[
          const SizedBox(height: 34),
          NexaSectionLabel('Coming soon'),
          for (var i = 0; i < soon.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            ComingSoonDeviceCard(
              device: soon[i],
              onTap: () => state.openDevice(soon[i].id),
            ),
          ],
          const SizedBox(height: 16),
          Text(
            'Nexa does not run on these yet. They are here because they are '
            'where she is going.',
            style: NexaType.body(size: 12.5, color: c.ink30)
                .copyWith(height: 1.6),
          ),
        ],
      ],
    );
  }
}

/// A product Nexa runs on today. Image first, then who it is, what she can do
/// there, and the one action worth offering.
class AvailableDeviceCard extends StatelessWidget {
  const AvailableDeviceCard({
    super.key,
    required this.device,
    required this.onTap,
    required this.onPair,
  });

  final NexaDevice device;
  final VoidCallback onTap;
  final VoidCallback onPair;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);

    return NexaPressable(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [c.cardTop, c.cardBottom],
          ),
          borderRadius: NexaRadius.sheetAll,
          border: Border.all(color: c.hairline, width: 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            SizedBox(
              height: 176,
              width: double.infinity,
              child: DeviceVisual(device: device, padding: 18),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    device.name,
                    style: NexaType.ui(
                      size: 17.5,
                      weight: FontWeight.w500,
                      color: c.ink,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    device.kind.label,
                    style: NexaType.body(size: 12.5, color: c.ink42),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    device.blurb,
                    style: NexaType.body(size: 13, color: c.ink50)
                        .copyWith(height: 1.6),
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: [
                      for (final cap in device.capabilities)
                        _CapabilityChip(label: cap.label),
                    ],
                  ),
                  const SizedBox(height: 18),
                  NexaEmeraldButton(label: 'Pair device', onTap: onPair),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A product Nexa is planned for. It keeps its real photography — it is a
/// real device, just not one she runs on yet — and its action says so
/// plainly rather than looking broken.
class ComingSoonDeviceCard extends StatelessWidget {
  const ComingSoonDeviceCard({
    super.key,
    required this.device,
    required this.onTap,
  });

  final NexaDevice device;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);

    return NexaPressable(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        decoration: BoxDecoration(
          color: c.surfaceQuiet,
          borderRadius: NexaRadius.sheetAll,
          border: Border.all(color: c.hairline, width: 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            SizedBox(
              width: 138,
              height: 116,
              child: DeviceVisual(
                device: device,
                padding: 14,
                driftSeconds: 17,
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(4, 16, 18, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      device.name,
                      style: NexaType.ui(
                        size: 15,
                        weight: FontWeight.w500,
                        color: c.ink82,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      device.kind.label,
                      style: NexaType.body(size: 12, color: c.ink36),
                    ),
                    const SizedBox(height: 11),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: NexaRadius.pillAll,
                        border: Border.all(color: c.hairlineStrong, width: 1),
                      ),
                      child: Text(
                        'Coming soon',
                        style: NexaType.label(
                          size: 9.5,
                          tracking: 0.2,
                          color: c.ink40,
                          weight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One capability, as a chip rather than a table row — a catalogue card is
/// scanned, not read.
class _CapabilityChip extends StatelessWidget {
  const _CapabilityChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: c.emeraldWash,
        borderRadius: NexaRadius.pillAll,
        border: Border.all(color: c.emeraldBorder, width: 1),
      ),
      child: Text(
        label,
        style: NexaType.ui(size: 12, color: c.emeraldBright),
      ),
    );
  }
}
