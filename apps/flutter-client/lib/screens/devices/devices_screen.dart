import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/models/device.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/device_visual.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_mark.dart';
import '../../widgets/nexa_page.dart';

/// The devices hub.
///
/// This tab answers two questions and no others: what do I already have, and
/// how do I add another. Everything Nexa merely *supports* lives one tap away
/// in the catalogue, so the account's own hardware is never buried under a
/// shop.
class DevicesScreen extends StatelessWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final mine = state.deviceRepository.mine();

    return NexaPage(
      title: 'Devices',
      subtitle: 'The devices Nexa can be present on.',
      children: [
        _AddDeviceButton(onTap: () => state.go(NexaScreen.connect)),
        const SizedBox(height: 30),

        if (mine.isEmpty)
          _NoDevicesYet(onAdd: () => state.go(NexaScreen.connect))
        else ...[
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Expanded(
                child: Text(
                  'YOUR DEVICES',
                  style: NexaType.label(
                    size: 10,
                    tracking: 0.24,
                    color: c.ink32,
                  ),
                ),
              ),
              Text(
                mine.length == 1 ? '1 device' : '${mine.length} devices',
                style: NexaType.ui(size: 12, color: c.ink30),
              ),
            ],
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < mine.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            NexaRiseIn(
              delay: NexaMotion.stagger * i,
              duration: const Duration(milliseconds: 460),
              distance: 12,
              child: MyDeviceCard(
                device: mine[i],
                onTap: () => state.openDevice(mine[i].id),
              ),
            ),
          ],
          const SizedBox(height: 20),
          Text(
            "Your phone is Nexa's gateway — voice, memory and account. A "
            'headset is what lets her be somewhere.',
            style: NexaType.body(size: 12.5, color: c.ink30)
                .copyWith(height: 1.6),
          ),
        ],
      ],
    );
  }
}

/// The one action this page is built around.
class _AddDeviceButton extends StatelessWidget {
  const _AddDeviceButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);

    return NexaPressable(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
        decoration: BoxDecoration(
          color: c.emeraldWash,
          borderRadius: NexaRadius.groupAll,
          border: Border.all(color: c.emeraldBorder, width: 1),
        ),
        child: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: c.emeraldBorder, width: 1),
              ),
              child: Text(
                '+',
                style: NexaType.ui(
                  size: 19,
                  color: c.emeraldBright,
                  height: 1.0,
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Add device',
                    style: NexaType.ui(
                      size: 15.5,
                      weight: FontWeight.w500,
                      color: c.emeraldBright,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Headsets, glasses and watches Nexa runs on.',
                    style: NexaType.body(size: 12.5, color: c.ink45),
                  ),
                ],
              ),
            ),
            Text('›', style: NexaType.ui(size: 17, color: c.emerald)),
          ],
        ),
      ),
    );
  }
}

/// Nothing paired yet. The account still has a phone, so this is rare — but
/// an account that has just been wiped should not land on a blank page.
class _NoDevicesYet extends StatelessWidget {
  const _NoDevicesYet({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);

    return Column(
      children: [
        const SizedBox(height: 26),
        const NexaMark(size: 128, glow: 58, glowOpacity: 0.4),
        const SizedBox(height: 34),
        Text(
          'No devices yet.',
          style: NexaType.display(size: 24, color: c.ink),
        ),
        const SizedBox(height: 12),
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 264),
          child: Text(
            'Connect Nexa to the things around you, and she can be present on '
            'any of them.',
            textAlign: TextAlign.center,
            style: NexaType.body(size: 14, color: c.ink45)
                .copyWith(height: 1.6),
          ),
        ),
        const SizedBox(height: 28),
        NexaPrimaryButton(label: 'Add your first device', onTap: onAdd),
      ],
    );
  }
}

/// A device already on the account.
///
/// The product is the card: it gets the top half at a size worth looking at,
/// with its name, kind and connection underneath. A row of text would say the
/// same thing and mean less.
class MyDeviceCard extends StatelessWidget {
  const MyDeviceCard({super.key, required this.device, required this.onTap});

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
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [c.cardTop, c.cardBottom],
          ),
          borderRadius: NexaRadius.sheetAll,
          border: Border.all(
            color: device.status == DeviceStatus.disconnected
                ? c.hairlineStrong
                : c.emeraldBorder,
            width: 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            SizedBox(
              height: 158,
              width: double.infinity,
              child: DeviceVisual(device: device, glow: 0.16, padding: 20),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 2, 20, 18),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          device.name,
                          style: NexaType.ui(
                            size: 17,
                            weight: FontWeight.w500,
                            color: c.ink,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          device.kind.label,
                          style: NexaType.body(size: 12.5, color: c.ink42),
                        ),
                        const SizedBox(height: 11),
                        DeviceStatusLine(status: device.status),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text('›', style: NexaType.ui(size: 18, color: c.ink34)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
