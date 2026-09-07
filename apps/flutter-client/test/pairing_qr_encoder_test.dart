import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/repositories/pairing_qr_encoder.dart';
import 'package:qr/qr.dart' show InputTooLongException;

void main() {
  const encoder = PairingQrEncoder();

  test('encoding the same payload twice produces an identical module matrix', () {
    const payload = 'NX2.the-exact-same-secret-both-times';
    final a = encoder.encode(payload);
    final b = encoder.encode(payload);

    expect(a.moduleCount, b.moduleCount);
    for (var row = 0; row < a.moduleCount; row++) {
      for (var col = 0; col < a.moduleCount; col++) {
        expect(a.isDark(row, col), b.isDark(row, col), reason: 'module ($row,$col) differed');
      }
    }
  });

  test('different payloads produce different module matrices', () {
    final a = encoder.encode('NX2.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    final b = encoder.encode('NX2.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    var anyDifferent = false;
    final size = a.moduleCount == b.moduleCount ? a.moduleCount : 0;
    for (var row = 0; row < size && !anyDifferent; row++) {
      for (var col = 0; col < size; col++) {
        if (a.isDark(row, col) != b.isDark(row, col)) {
          anyDifferent = true;
          break;
        }
      }
    }
    expect(
      a.moduleCount != b.moduleCount || anyDifferent,
      isTrue,
      reason: 'two different payloads produced an identical QR symbol',
    );
  });

  test('an empty payload is rejected', () {
    expect(() => encoder.encode(''), throwsArgumentError);
  });

  test('a real NX2.<secret> payload encodes without any transformation applied first', () {
    // The payload this app actually produces: 'NX2.' plus a 43-character
    // base64url secret (randomSecret() on the backend — 256 bits, unpadded).
    const code = 'NX2.k3F7hQpN2xVw9sT1yLbR4mZaXeC6oGdUj0iH8fB5nAq';
    expect(code.length, 47);

    // Encodes at all — QrCode.fromData throws if it cannot represent the
    // string exactly; reaching this line without throwing already proves
    // the payload was accepted as given, no re-encoding or stripping of
    // the 'NX2.' prefix or any other character.
    final qr = encoder.encode(code);
    expect(qr.payload, code);
    expect(qr.moduleCount, greaterThan(0));
  });

  test('a payload much longer than a pairing code stays valid', () {
    final longPayload = 'NX2.${'a' * 500}';
    final qr = encoder.encode(longPayload);
    expect(qr.moduleCount, greaterThan(0));
    expect(qr.payload, longPayload);
  });

  test('a payload past QR\'s own capacity is refused, not silently truncated', () {
    final tooLong = 'a' * 5000;
    expect(() => encoder.encode(tooLong), throwsA(isA<InputTooLongException>()));
  });

  test('PairingQrCode carries exactly the payload and module data — nothing else', () {
    final qr = encoder.encode('NX2.only-the-code-nothing-more');

    // No accessToken/refreshToken/pairingSessionId/userId field exists on
    // this type at all — this is an API-shape guarantee, not a runtime
    // check, but the point stands: there is nothing here to serialize.
    expect(qr.payload, 'NX2.only-the-code-nothing-more');
  });
}
