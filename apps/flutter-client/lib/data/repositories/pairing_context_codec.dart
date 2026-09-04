import 'dart:convert';

import '../models/pairing_context_message.dart';
import 'pairing_lan_envelope.dart';

/// Turns a [PairingContextMessage] into wire bytes and back — the
/// `pairing_context` counterpart to [HeadsetAdvertisementCodec], following
/// exactly the same pattern: [PairingLanEnvelope] handles what is common to
/// every message type, this class handles only its own type's fields.
abstract final class PairingContextCodec {
  static String encode(PairingContextMessage message) =>
      jsonEncode(PairingLanEnvelope.encode('pairing_context', message.toJson()));

  /// Returns `null` for anything that is not a well-formed `pairing_context`
  /// envelope — wrong magic, an oversized string, a different (or missing)
  /// type, or a missing/wrongly-typed `pairingSessionId`. Never throws.
  static PairingContextMessage? decode(String raw) {
    final envelope = PairingLanEnvelope.decode(raw);
    if (envelope == null) return null;

    final type = envelope['type'] as String? ?? 'advertisement';
    if (type != 'pairing_context') return null;

    try {
      return PairingContextMessage.fromJson(envelope);
    } on TypeError {
      return null;
    }
  }
}
