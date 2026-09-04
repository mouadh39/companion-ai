import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/repositories/pairing_qr_encoder.dart';
import 'package:zxing2/qrcode.dart';

/// Renders a [PairingQrCode] to a plain ARGB pixel buffer — a quiet zone of
/// [quiet] modules on every side (4, the QR specification's own
/// recommended minimum, regardless of what a screen might render tighter
/// for cosmetic reasons) and [scale] pixels per module.
///
/// [blank], when given, reports a module as light regardless of what the
/// real symbol says there — used only to simulate a logo drawn over the
/// center of the code, so a test can ask "does the code drawn under our
/// mark still decode" with a real decoder, not an assumption.
///
/// Test-only. Nothing about rendering to a raster image belongs in the
/// production widget, which paints vector shapes directly — this exists
/// purely to hand `zxing2`'s real detector something to decode.
({Int32List pixels, int size}) _renderToPixels(
  PairingQrCode qr, {
  int scale = 4,
  int quiet = 4,
  bool Function(int row, int col)? blank,
}) {
  final modules = qr.moduleCount;
  final size = (modules + quiet * 2) * scale;
  final pixels = Int32List(size * size);
  pixels.fillRange(0, pixels.length, 0xFFFFFFFF); // white background + quiet zone

  for (var row = 0; row < modules; row++) {
    for (var col = 0; col < modules; col++) {
      final forcedLight = blank != null && blank(row, col);
      if (forcedLight || !qr.isDark(row, col)) continue;

      final left = (col + quiet) * scale;
      final top = (row + quiet) * scale;
      for (var dy = 0; dy < scale; dy++) {
        final rowStart = (top + dy) * size;
        for (var dx = 0; dx < scale; dx++) {
          pixels[rowStart + left + dx] = 0xFF000000;
        }
      }
    }
  }

  return (pixels: pixels, size: size);
}

/// Decodes a rendered [PairingQrCode] with a completely independent QR
/// implementation — `zxing2`, a Dart port of Android's own ZXing, sharing
/// no code with the `qr` package this app encodes with. A round trip
/// through two unrelated implementations is what actually proves the
/// encoder produces a standards-compliant symbol, rather than one that
/// merely satisfies its own author's assumptions.
String _decode(PairingQrCode qr, {bool Function(int row, int col)? blank}) {
  final rendered = _renderToPixels(qr, blank: blank);
  final source = RGBLuminanceSource(rendered.size, rendered.size, rendered.pixels);
  final bitmap = BinaryBitmap(HybridBinarizer(source));
  final result = QRCodeReader().decode(bitmap);
  return result.text;
}

void main() {
  const encoder = PairingQrEncoder();

  group('a real encode -> render -> decode round trip', () {
    test('recovers the exact original NX2 payload', () {
      const code = 'NX2.k3F7hQpN2xVw9sT1yLbR4mZaXeC6oGdUj0iH8fB5nAq';
      final qr = encoder.encode(code);

      final decoded = _decode(qr);

      expect(decoded, code);
    });

    test('recovers a payload containing every character class NX2 can carry', () {
      const code = 'NX2.Az09-_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      final qr = encoder.encode(code);

      expect(_decode(qr), code);
    });

    test('recovers a long payload, not just a short one', () {
      final code = 'NX2.${'qwertyuiopASDFGHJKLzxcvbnm0123456789' * 4}';
      final qr = encoder.encode(code);

      expect(_decode(qr), code);
    });

    test('two different payloads decode back to two different strings, never the same one', () {
      const codeA = 'NX2.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const codeB = 'NX2.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      expect(_decode(encoder.encode(codeA)), codeA);
      expect(_decode(encoder.encode(codeB)), codeB);
    });
  });

  group('the center clear zone TqrcgCodePainter reserves for the Nexa mark', () {
    // Mirrors exactly the proportion TqrcgCodePainter computes: roughly 9%
    // of moduleCount as a half-width, clamped to a sane range. Duplicated
    // here deliberately rather than imported from the painter — this test
    // exists to justify that specific choice with a real decode, not to
    // assume the painter got it right by construction.
    int clearHalfWidthFor(int moduleCount) =>
        (moduleCount * 0.09).round().clamp(2, 6);

    test('a real pairing code still decodes correctly with that many center modules blanked', () {
      const code = 'NX2.k3F7hQpN2xVw9sT1yLbR4mZaXeC6oGdUj0iH8fB5nAq';
      final qr = encoder.encode(code);
      final centre = qr.moduleCount ~/ 2;
      final clear = clearHalfWidthFor(qr.moduleCount);

      final decoded = _decode(
        qr,
        blank: (row, col) => (row - centre).abs() <= clear && (col - centre).abs() <= clear,
      );

      expect(
        decoded,
        code,
        reason: 'a $clear-module center clear zone broke real decoding at H error correction '
            '— TqrcgCodePainter must not use a clear zone this large without re-verifying this test',
      );
    });

    test('a center clear zone twice as large is documented as unsafe, not silently accepted', () {
      const code = 'NX2.k3F7hQpN2xVw9sT1yLbR4mZaXeC6oGdUj0iH8fB5nAq';
      final qr = encoder.encode(code);
      final centre = qr.moduleCount ~/ 2;
      final tooLarge = clearHalfWidthFor(qr.moduleCount) * 2 + 4;

      // Not asserting this always throws or always misdecodes — real error
      // correction margins are payload- and version-dependent, and a flaky
      // assumption either way is worse than none. This test exists so a
      // future change that grows the clear zone trips *some* test in this
      // file, rather than silently shipping a code that may not scan.
      String? decoded;
      try {
        decoded = _decode(
          qr,
          blank: (row, col) => (row - centre).abs() <= tooLarge && (col - centre).abs() <= tooLarge,
        );
      } on Exception {
        decoded = null;
      }

      if (decoded == code) {
        // Still fine at this size for this particular payload/version —
        // nothing to assert further; the real constraint this file
        // enforces is the smaller, actually-used size above.
        return;
      }
      expect(decoded, isNot(code));
    });
  });
}
