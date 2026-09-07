import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/repositories/pairing_lan_envelope.dart';

void main() {
  group('valid message', () {
    test('a well-formed envelope with a known type decodes to its JSON object', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v1', 'type': 'advertisement', 'x': 1});

      final decoded = PairingLanEnvelope.decode(raw);

      expect(decoded, {'magic': 'nexa.pairing.v1', 'type': 'advertisement', 'x': 1});
    });

    test('a message with no type field at all defaults to advertisement — backward compatible', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v1', 'deviceName': 'x'});

      expect(PairingLanEnvelope.decode(raw), isNotNull);
    });

    test('encode() writes an explicit type field', () {
      final envelope = PairingLanEnvelope.encode('advertisement', {'a': 1});

      expect(envelope['type'], 'advertisement');
      expect(envelope['magic'], 'nexa.pairing.v1');
      expect(envelope['a'], 1);
    });
  });

  group('malformed message', () {
    test('not JSON at all is rejected', () {
      expect(PairingLanEnvelope.decode('not json'), isNull);
    });

    test('a JSON array instead of an object is rejected', () {
      expect(PairingLanEnvelope.decode('[1,2,3]'), isNull);
    });

    test('a bare JSON scalar is rejected', () {
      expect(PairingLanEnvelope.decode('42'), isNull);
    });

    test('an empty string is rejected', () {
      expect(PairingLanEnvelope.decode(''), isNull);
    });
  });

  group('unsupported version', () {
    // This protocol versions by bumping `magic` wholesale (see the class
    // doc — the same convention the backend's own challenge domain tags
    // use), so "unsupported version" and "wrong magic" are the same check.
    test('a future/different magic is rejected as this build not supporting it', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v2', 'type': 'advertisement'});
      expect(PairingLanEnvelope.decode(raw), isNull);
    });

    test('a completely unrelated magic is rejected', () {
      final raw = jsonEncode({'magic': 'some-other-protocol', 'type': 'advertisement'});
      expect(PairingLanEnvelope.decode(raw), isNull);
    });

    test('a missing magic field entirely is rejected', () {
      final raw = jsonEncode({'type': 'advertisement'});
      expect(PairingLanEnvelope.decode(raw), isNull);
    });
  });

  group('unknown message type', () {
    test('a syntactically valid envelope naming a type this build does not know is rejected', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v1', 'type': 'self_destruct'});
      expect(PairingLanEnvelope.decode(raw), isNull);
    });

    test('a type field of the wrong JSON type (not a string) is rejected, not coerced', () {
      final raw = jsonEncode({'magic': 'nexa.pairing.v1', 'type': 123});
      expect(PairingLanEnvelope.decode(raw), isNull);
    });
  });

  group('oversized payload', () {
    test('a raw string longer than maxEncodedChars is rejected before any JSON parsing', () {
      final huge = 'x' * (PairingLanEnvelope.maxEncodedChars + 1);
      expect(PairingLanEnvelope.decode(huge), isNull);
    });

    test('a raw string exactly at the limit is not rejected for size alone', () {
      // Padding a syntactically valid envelope out to exactly the limit
      // with whitespace, which jsonDecode tolerates.
      final base = jsonEncode({'magic': 'nexa.pairing.v1', 'type': 'advertisement'});
      final padded = base.padRight(PairingLanEnvelope.maxEncodedChars);
      expect(padded.length, PairingLanEnvelope.maxEncodedChars);

      expect(PairingLanEnvelope.decode(padded), isNotNull);
    });
  });
}
