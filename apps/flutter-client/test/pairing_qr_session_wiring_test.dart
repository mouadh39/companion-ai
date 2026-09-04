import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/pairing_api.dart';
import 'package:nexa_client/data/repositories/pairing_qr_encoder.dart';

void main() {
  test('a QR built from a PairingSession encodes exactly session.code — nothing wrapped around it', () {
    final session = PairingSession(
      pairingSessionId: 'sess-1',
      code: 'NX2.the-only-thing-that-may-go-in-the-qr',
      expiresAt: DateTime.now().add(const Duration(minutes: 2)),
    );

    final qr = const PairingQrEncoder().encode(session.code);

    expect(qr.payload, session.code);
    expect(qr.payload, 'NX2.the-only-thing-that-may-go-in-the-qr');
  });

  test('PairingSession itself never appears in the QR payload — not pairingSessionId, not expiresAt', () {
    final session = PairingSession(
      pairingSessionId: 'a-pairing-session-id-that-must-never-appear-in-a-qr',
      code: 'NX2.the-real-code',
      expiresAt: DateTime.now().add(const Duration(minutes: 2)),
    );

    final qr = const PairingQrEncoder().encode(session.code);

    expect(qr.payload, isNot(contains(session.pairingSessionId)));
    expect(qr.payload, isNot(contains(session.expiresAt.toIso8601String())));
    expect(qr.payload.length, session.code.length);
  });

  test('PairingQrCode.toString does not serialize the payload or any other credential', () {
    final qr = const PairingQrEncoder().encode('NX2.do-not-print-me');

    // PairingQrCode declares no toString() override, so this exercises the
    // plain Object default — locking in that nobody has added one that
    // would accidentally start printing the payload or module data.
    final text = qr.toString();
    expect(text, isNot(contains('do-not-print-me')));
  });
}
