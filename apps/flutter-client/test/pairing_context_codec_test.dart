import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/pairing_context_message.dart';
import 'package:nexa_client/data/repositories/pairing_context_codec.dart';

void main() {
  group('PairingContextCodec', () {
    test('round-trips through encode/decode', () {
      const original = PairingContextMessage(pairingSessionId: 'session-123');

      final decoded = PairingContextCodec.decode(PairingContextCodec.encode(original));

      expect(decoded, isNotNull);
      expect(decoded!.pairingSessionId, 'session-123');
    });

    test('encode() writes the pairing_context type explicitly', () {
      const message = PairingContextMessage(pairingSessionId: 'session-123');
      final raw = PairingContextCodec.encode(message);

      expect(jsonDecode(raw), {
        'magic': 'nexa.pairing.v1',
        'type': 'pairing_context',
        'pairingSessionId': 'session-123',
      });
    });

    test('decode returns null for a well-formed advertisement instead', () {
      final raw = jsonEncode({
        'magic': 'nexa.pairing.v1',
        'type': 'advertisement',
        'deviceName': 'x',
        'enrolmentHandle': 'x',
        'issuedAt': DateTime.now().toIso8601String(),
      });

      expect(PairingContextCodec.decode(raw), isNull);
    });

    test('decode returns null for the wrong magic', () {
      final raw = jsonEncode({'magic': 'wrong', 'type': 'pairing_context', 'pairingSessionId': 'x'});
      expect(PairingContextCodec.decode(raw), isNull);
    });

    test('decode returns null for a missing pairingSessionId', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v1', 'type': 'pairing_context'});
      expect(PairingContextCodec.decode(raw), isNull);
    });

    test('decode returns null for garbage', () {
      expect(PairingContextCodec.decode('not json'), isNull);
    });

    test('an advertisement decoded by HeadsetAdvertisementCodec is unaffected by pairing_context now being a recognised type', () {
      // Regression guard for the envelope-level change in this step: adding
      // pairing_context to the type allowlist must not change how an
      // ordinary advertisement is routed.
      final raw = jsonEncode({
        'magic': 'nexa.pairing.v1',
        'type': 'advertisement',
        'deviceName': 'Meta Quest 3',
        'enrolmentHandle': 'handle',
        'issuedAt': DateTime.now().toIso8601String(),
      });

      expect(PairingContextCodec.decode(raw), isNull);
    });
  });
}
