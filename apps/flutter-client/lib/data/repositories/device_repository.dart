import '../models/device.dart';

/// Reads the devices on this account.
///
/// The screens depend on this, never on the list below — when the backend
/// exposes a device service, it implements this interface and the UI does not
/// change.
abstract interface class DeviceRepository {
  /// Everything in the catalogue, paired or not.
  List<NexaDevice> all();

  /// The devices this account has paired, this phone first.
  List<NexaDevice> mine();

  /// Supported devices the account has not paired yet.
  List<NexaDevice> pairable();

  /// Devices Nexa is planned for but does not run on yet.
  List<NexaDevice> comingSoon();

  NexaDevice? byId(String id);

  /// Record a pairing. Local-only until the backend owns device state.
  void markPaired(String id);

  /// Drop a pairing.
  void forget(String id);
}

/// A deterministic in-memory catalogue.
///
/// This is local demo data, not backend state: nothing here survives a
/// restart, and `markPaired` changes only what this process can see.
class LocalDeviceRepository implements DeviceRepository {
  LocalDeviceRepository();

  static const _asset = 'assets/devices';

  final Map<String, DeviceStatus> _overrides = {};

  static final List<NexaDevice> _catalogue = [
    const NexaDevice(
      id: 'iphone',
      name: 'iPhone 16 Pro Max',
      kind: DeviceKind.phone,
      status: DeviceStatus.thisDevice,
      image: '$_asset/nxa-iphone.webp',
      blurb: 'This device. Nexa listens here and keeps everything in sync.',
      capabilityLabel: 'On this device',
      capabilities: [
        DeviceCapability('Nexa', 'Always'),
        DeviceCapability('Voice', 'Always'),
        DeviceCapability('Memory', 'Synced'),
        DeviceCapability('Account', 'Signed in'),
      ],
      facts: [
        DeviceFact('Role', 'Gateway'),
        DeviceFact('Last active', 'Now'),
      ],
    ),
    const NexaDevice(
      id: 'quest3',
      name: 'Meta Quest 3',
      kind: DeviceKind.headset,
      status: DeviceStatus.connected,
      image: '$_asset/nxa-quest3.webp',
      blurb: 'Nexa can be present in the space around you here.',
      capabilityLabel: 'Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Embodied'),
        DeviceCapability('Voice', 'Spatial'),
        DeviceCapability('Nexa Vision', 'Available'),
        DeviceCapability('Spatial experience', 'Available'),
      ],
      facts: [
        DeviceFact('Connection', 'Connected'),
        DeviceFact('Last active', 'Today'),
        DeviceFact('Paired', '12 August'),
      ],
      requiresGuidedPairing: true,
    ),
    const NexaDevice(
      id: 'galaxy',
      name: 'Galaxy S22 Ultra',
      kind: DeviceKind.phone,
      status: DeviceStatus.connected,
      image: '$_asset/nxa-galaxy.webp',
      blurb: 'A second phone signed in to your Nexa account.',
      capabilityLabel: 'On this device',
      capabilities: [
        DeviceCapability('Nexa', 'Available'),
        DeviceCapability('Voice', 'Available'),
        DeviceCapability('Memory', 'Synced'),
      ],
      facts: [
        DeviceFact('Connection', 'Connected'),
        DeviceFact('Last active', '3 days ago'),
      ],
    ),
    const NexaDevice(
      id: 'watch',
      name: 'Apple Watch',
      kind: DeviceKind.watch,
      status: DeviceStatus.disconnected,
      image: '$_asset/nxa-watch.webp',
      imageAspect: 0.67,
      blurb: 'A wrist-sized door to Nexa. Voice only, always close.',
      capabilityLabel: 'Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Quick access'),
        DeviceCapability('Voice access', 'Available'),
      ],
      facts: [
        DeviceFact('Connection', 'Out of range'),
        DeviceFact('Last active', 'Yesterday'),
      ],
    ),
    const NexaDevice(
      id: 'quest3s',
      name: 'Meta Quest 3S',
      kind: DeviceKind.headset,
      status: DeviceStatus.available,
      image: '$_asset/nxa-quest3s.webp',
      blurb: 'Bring Nexa into your headset. Takes about a minute.',
      capabilityLabel: 'Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Embodied'),
        DeviceCapability('Voice', 'Spatial'),
        DeviceCapability('Nexa Vision', 'Available'),
        DeviceCapability('Spatial experience', 'Available'),
      ],
      requiresGuidedPairing: true,
      pairingSummary:
          'You will put the headset on and open Nexa there. Keep it nearby: '
          'this phone connects to it, then shows a code for it to read.',
    ),
    const NexaDevice(
      id: 'questpro',
      name: 'Meta Quest Pro',
      kind: DeviceKind.headset,
      status: DeviceStatus.available,
      image: '$_asset/nxa-questpro.webp',
      blurb:
          'Nexa at her most present — full spatial awareness and expression.',
      capabilityLabel: 'Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Embodied'),
        DeviceCapability('Voice', 'Spatial'),
        DeviceCapability('Nexa Vision', 'Available'),
        DeviceCapability('Spatial experience', 'Available'),
      ],
      requiresGuidedPairing: true,
      pairingSummary:
          'You will put the headset on and open Nexa there. Keep it nearby: '
          'this phone connects to it, then shows a code for it to read.',
    ),
    const NexaDevice(
      id: 'rayban',
      name: 'Ray-Ban Meta',
      kind: DeviceKind.glasses,
      status: DeviceStatus.available,
      image: '$_asset/nxa-rayban.webp',
      imageAspect: 0.67,
      blurb: 'Nexa, quietly with you all day.',
      capabilityLabel: 'Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Ambient'),
        DeviceCapability('Voice', 'Available'),
        DeviceCapability('Nexa Vision', 'Available'),
      ],
      pairingSummary:
          'You will confirm the pairing in the Meta View app, then Nexa is '
          'ready on your glasses.',
    ),
    const NexaDevice(
      id: 'rbdisplay',
      name: 'Meta Ray-Ban Display',
      kind: DeviceKind.glasses,
      status: DeviceStatus.comingSoon,
      image: '$_asset/nxa-rbdisplay.webp',
      imageAspect: 2.0,
      blurb: 'Nexa will arrive here. We will tell you the moment it works.',
      capabilityLabel: 'Planned Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Planned'),
        DeviceCapability('Voice', 'Planned'),
        DeviceCapability('Nexa Vision', 'Planned'),
        DeviceCapability('Spatial experience', 'Planned'),
      ],
    ),
    const NexaDevice(
      id: 'oakley',
      name: 'Oakley Meta',
      kind: DeviceKind.glasses,
      status: DeviceStatus.comingSoon,
      image: '$_asset/nxa-oakley.webp',
      blurb: 'Nexa will arrive here. We will tell you the moment it works.',
      capabilityLabel: 'Planned Nexa experience',
      capabilities: [
        DeviceCapability('Nexa', 'Planned'),
        DeviceCapability('Voice', 'Planned'),
        DeviceCapability('Nexa Vision', 'Planned'),
      ],
    ),
  ];

  NexaDevice _applyOverride(NexaDevice d) {
    final status = _overrides[d.id];
    if (status == null) return d;
    return NexaDevice(
      id: d.id,
      name: d.name,
      kind: d.kind,
      status: status,
      image: d.image,
      imageAspect: d.imageAspect,
      blurb: d.blurb,
      capabilityLabel: d.capabilityLabel,
      capabilities: d.capabilities,
      facts: d.facts,
      requiresGuidedPairing: d.requiresGuidedPairing,
      pairingSummary: d.pairingSummary,
    );
  }

  @override
  List<NexaDevice> all() => _catalogue.map(_applyOverride).toList();

  @override
  List<NexaDevice> mine() =>
      all().where((d) => d.status.isPaired).toList()
        ..sort((a, b) {
          if (a.status == DeviceStatus.thisDevice) return -1;
          if (b.status == DeviceStatus.thisDevice) return 1;
          return 0;
        });

  @override
  List<NexaDevice> pairable() =>
      all().where((d) => d.status == DeviceStatus.available).toList();

  @override
  List<NexaDevice> comingSoon() =>
      all().where((d) => d.status == DeviceStatus.comingSoon).toList();

  @override
  NexaDevice? byId(String id) {
    for (final d in all()) {
      if (d.id == id) return d;
    }
    return null;
  }

  @override
  void markPaired(String id) => _overrides[id] = DeviceStatus.connected;

  @override
  void forget(String id) => _overrides[id] = DeviceStatus.available;
}
