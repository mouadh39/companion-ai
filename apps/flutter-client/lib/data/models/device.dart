/// What kind of thing a device is. Drives grouping and the copy that
/// describes what Nexa can be there.
enum DeviceKind {
  phone('Phone'),
  watch('Watch'),
  headset('Headset'),
  glasses('Glasses');

  const DeviceKind(this.label);

  final String label;
}

/// Where a device stands in relation to this account.
enum DeviceStatus {
  /// The phone the app is running on.
  thisDevice('This device'),

  /// Paired and reachable.
  connected('Connected'),

  /// Paired, but not reachable right now.
  disconnected('Disconnected'),

  /// Supported and pairable, but not paired yet.
  available('Not paired'),

  /// Nexa does not run here yet.
  comingSoon('Coming soon');

  const DeviceStatus(this.label);

  final String label;

  bool get isPaired =>
      this == DeviceStatus.thisDevice ||
      this == DeviceStatus.connected ||
      this == DeviceStatus.disconnected;

  bool get isPairable => this == DeviceStatus.available;
}

/// One line in a device's capability table — what Nexa can do there, and
/// under what condition.
class DeviceCapability {
  const DeviceCapability(this.label, this.note);

  final String label;
  final String note;
}

/// A labelled fact about the device itself, rather than about Nexa on it.
class DeviceFact {
  const DeviceFact(this.label, this.value);

  final String label;
  final String value;
}

/// A device Nexa can live on.
///
/// Every screen that shows a device reads it from here, so adding a product
/// is one entry rather than a new screen: the catalogue, the detail page, the
/// pairing flow and the status pills are all driven off these fields.
class NexaDevice {
  const NexaDevice({
    required this.id,
    required this.name,
    required this.kind,
    required this.status,
    required this.image,
    required this.blurb,
    required this.capabilityLabel,
    required this.capabilities,
    this.facts = const [],
    this.requiresGuidedPairing = false,
    this.pairingSummary,
    this.imageAspect = 1.0,
  });

  final String id;
  final String name;
  final DeviceKind kind;
  final DeviceStatus status;

  /// Asset path for the product shot.
  final String image;

  /// Its natural aspect ratio, so cards can reserve the right room.
  final double imageAspect;

  /// One or two sentences, in Nexa's voice, about what this device is for.
  final String blurb;

  /// Heading above the capability table — it differs for a device Nexa
  /// already lives on versus one she is only planned for.
  final String capabilityLabel;

  final List<DeviceCapability> capabilities;
  final List<DeviceFact> facts;

  /// Whether pairing needs the illustrated headset guide rather than a
  /// single confirmation.
  final bool requiresGuidedPairing;

  /// What the user is about to do, shown before the flow starts.
  final String? pairingSummary;

  /// The capability names, joined — the one-line summary a card shows.
  String get capabilitySummary => capabilities.map((c) => c.label).join(' · ');

  /// The primary action for this device, given where it stands.
  String get primaryAction => switch (status) {
    DeviceStatus.thisDevice => 'Talk to Nexa',
    DeviceStatus.connected => 'Open Nexa',
    DeviceStatus.disconnected => 'Reconnect',
    DeviceStatus.available => 'Pair device',
    DeviceStatus.comingSoon => 'Notify me',
  };

  /// The quieter action beneath it, if there is one.
  String? get secondaryAction => switch (status) {
    DeviceStatus.connected || DeviceStatus.disconnected => 'Forget this device',
    _ => null,
  };
}
