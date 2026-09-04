import 'dart:async';
import 'dart:convert';

import '../models/headset_advertisement.dart';
import 'device_link_service.dart';
import 'pairing.dart';
import 'pairing_lan_envelope.dart';

/// The wire envelope a [HeadsetAdvertisement] travels in, and the one place
/// that turns raw transport bytes into one (or decides they are not one at
/// all).
///
/// Envelope-level concerns — the `magic` tag, oversized-input rejection, and
/// message-type routing — belong to [PairingLanEnvelope] now, not here; this
/// class's own job is exactly one type's worth of translation: the
/// `advertisement` envelope's fields into a [HeadsetAdvertisement], or a
/// clear `null` for anything that does not amount to one. See
/// [PairingLanEnvelope]'s own doc for why that split exists and why it does
/// not change this class's wire format or public API.
abstract final class HeadsetAdvertisementCodec {
  static String encode(HeadsetAdvertisement advertisement) =>
      jsonEncode(PairingLanEnvelope.encode('advertisement', advertisement.toJson()));

  /// Returns `null` for absolutely anything this cannot confidently read as
  /// one of ours: not JSON, the wrong magic, an unsupported message type,
  /// missing or wrongly-typed fields. A real transport is expected to
  /// receive arbitrary noise on a shared local network, and none of it may
  /// ever be mistaken for a genuine advertisement — silently ignoring it is
  /// the only correct response, never guessing at a partial reading.
  static HeadsetAdvertisement? decode(String raw) {
    final envelope = PairingLanEnvelope.decode(raw);
    if (envelope == null) return null;

    // PairingLanEnvelope.decode only confirms the type is one this build
    // recognises *at all* — routing to the right per-type codec is each
    // codec's own job, the same way a switch over `type` would be if there
    // were more than one of these today. Explicit rather than assumed, so
    // adding a second type later cannot silently make this class start
    // misreading it as an advertisement.
    final type = envelope['type'] as String? ?? 'advertisement';
    if (type != 'advertisement') return null;

    try {
      return HeadsetAdvertisement.fromJson(envelope);
    } on TypeError {
      return null;
    }
  }
}

/// The platform-neutral half of a real [DeviceLinkService]: everything
/// about turning a stream of already-received raw local-transport messages
/// into [PairingProgress] events, and nothing about how those messages
/// physically arrived.
///
/// A concrete transport — LAN today; see the report for why, and for what
/// BLE would need before it could be considered — supplies [openMessages],
/// a function returning a fresh `Stream<String>` of whatever it received
/// (one already-decoded-from-bytes-to-text payload per event; turning
/// datagrams or GATT writes into UTF-8 strings is the one thing this class
/// asks of its transport and the only thing a transport needs to provide).
/// This class owns everything after that: filtering by which device the
/// caller actually asked for, deciding when enough time has passed with no
/// match to call it failed, and shaping every step into the same
/// [PairingProgress] stream [LocalDeviceLinkService] already produces —
/// screens written against [DeviceLinkService] do not need to know which
/// implementation they are holding.
///
/// ## Why tests do not need a separate fake transport
///
/// [openMessages] is exactly the seam a test needs: feeding this class a
/// controlled `Stream<String>` exercises the *real* protocol-handling logic
/// — matching, timing out, rejecting a malformed or wrong-device message —
/// with no socket, no platform channel, and no real transport of any kind
/// involved. A parallel fake implementation of [DeviceLinkService] would
/// only risk drifting from what this class actually does; injecting the
/// message source instead means there is exactly one implementation to get
/// right.
class LocalTransportPairingLink implements DeviceLinkService {
  LocalTransportPairingLink({
    required Stream<String> Function() openMessages,
    this.timeout = const Duration(seconds: 30),
  }) : _openMessages = openMessages;

  final Stream<String> Function() _openMessages;
  final Duration timeout;

  StreamController<PairingProgress>? _controller;
  StreamSubscription<String>? _subscription;
  Timer? _timeoutTimer;

  @override
  Stream<PairingProgress> link({
    required String deviceId,
    String? deviceName,
  }) {
    _teardown();
    final controller = StreamController<PairingProgress>();
    _controller = controller;

    final name = deviceName ?? 'your headset';
    controller.add(
      PairingProgress(
        phase: PairingPhase.discovering,
        message: 'Looking for $name…',
      ),
    );

    _timeoutTimer = Timer(timeout, () {
      if (controller.isClosed) return;
      controller.add(
        PairingProgress(
          phase: PairingPhase.failed,
          message: "Couldn't find $name nearby. Make sure it's turned on and close by.",
          failure: 'timeout',
        ),
      );
      controller.close();
    });

    _subscription = _openMessages().listen((raw) {
      if (controller.isClosed) return;

      final advertisement = HeadsetAdvertisementCodec.decode(raw);
      // Malformed, or genuinely not one of ours — see the codec's own doc.
      // Never surfaced to the UI as a failure: plenty of local-network
      // traffic is neither, and one bad packet must not read as "the
      // headset failed" when the right one may arrive a moment later.
      if (advertisement == null) return;

      // Wrong-device rejection at the protocol level: an advertisement
      // whose own name does not match what this call is looking for is
      // exactly the same as silence, from this stream's point of view —
      // it is evidence of some *other* headset, not a failure of this one.
      if (deviceName != null && advertisement.deviceName != deviceName) {
        return;
      }

      _timeoutTimer?.cancel();
      controller.add(
        PairingProgress(
          phase: PairingPhase.deviceFound,
          message: '$name found.',
        ),
      );
      controller.add(
        PairingProgress(
          phase: PairingPhase.connected,
          message: 'Connected to $name.',
          enrolmentHandle: advertisement.enrolmentHandle,
        ),
      );
      controller.close();
    });

    return controller.stream;
  }

  @override
  Future<void> cancel() async => _teardown();

  void _teardown() {
    _timeoutTimer?.cancel();
    _timeoutTimer = null;
    unawaited(_subscription?.cancel());
    _subscription = null;
    final c = _controller;
    _controller = null;
    if (c != null && !c.isClosed) c.close();
  }
}
