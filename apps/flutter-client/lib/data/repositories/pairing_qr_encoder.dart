import 'package:qr/qr.dart';

/// A standards-compliant QR-code encoding of one pairing session's code —
/// the real module matrix a genuine QR scanner reads, not a rendering
/// detail.
///
/// Deliberately holds no more than a real scanner would ever need:
/// [moduleCount] and [isDark] are exactly `QrImage`'s own surface. [payload]
/// is kept alongside only so a widget holding one of these can tell "this
/// is still the same code" from "a new one replaced it" — see
/// `TqrcgCodePainter.shouldRepaint` — without ever re-deriving it from the
/// module matrix.
class PairingQrCode {
  const PairingQrCode._(this.payload, this._image);

  /// The exact string this was built from — see `PairingQrEncoder.encode`.
  /// Never anything this type derived, transformed, or guessed.
  final String payload;

  final QrImage _image;

  /// The QR grid's side length, in modules. Varies with [payload]'s length
  /// and the error-correction level `PairingQrEncoder` chose — never fixed,
  /// unlike the placeholder pattern this type replaces.
  int get moduleCount => _image.moduleCount;

  /// Whether the module at ([row], [col]) is dark. The entire real QR
  /// symbol — finder patterns, timing patterns, format information, the
  /// encoded data and its Reed–Solomon error-correction codewords — lives
  /// in this single method; nothing about it is specific to this app.
  bool isDark(int row, int col) => _image.isDark(row, col);
}

/// Turns a pairing code into a [PairingQrCode] — and nothing else.
///
/// This class does not know what a pairing session is, does not call the
/// backend, and does not decide when a code is shown or for how long; see
/// `PairingSessionRepository` for all of that. It receives exactly the
/// string it is given and encodes exactly that string — no wrapping, no
/// added fields, no transformation. `PairingSession.code` in, one QR
/// symbol out.
class PairingQrEncoder {
  const PairingQrEncoder();

  /// Encodes [payload] as a QR symbol.
  ///
  /// High error correction (`QrErrorCorrectLevel.H`, ~30% of codewords
  /// recoverable) — chosen because a pairing code is short enough that
  /// even the highest level keeps the symbol small, and headroom here is
  /// what makes a center mark drawn over some modules (see
  /// `TqrcgCodePainter`) survive real-world scanning conditions at all.
  ///
  /// Throws [ArgumentError] for an empty payload — there is no such thing
  /// as a QR code encoding nothing, and this method must not paper over
  /// that by inventing content. Throws whatever the underlying `qr`
  /// package throws (`InputTooLongException`) for a payload past QR's own
  /// version-40 capacity; this method adds no length limit of its own.
  PairingQrCode encode(String payload) {
    if (payload.isEmpty) {
      throw ArgumentError.value(payload, 'payload', 'A pairing code must not be empty.');
    }

    final qrCode = QrCode.fromData(
      data: payload,
      errorCorrectLevel: QrErrorCorrectLevel.H,
    );
    return PairingQrCode._(payload, QrImage(qrCode));
  }
}
