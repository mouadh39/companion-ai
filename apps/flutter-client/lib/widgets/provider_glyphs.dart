import 'dart:math' as math;

import 'package:flutter/material.dart';

/// The identity providers the auth screen offers.
enum AuthBrand { google, apple, meta, passkey }

/// A provider mark, drawn monochrome at whatever size it is given.
///
/// These are deliberately single-colour silhouettes rather than the brands'
/// full-colour badges: the auth screen is a Nexa surface, and three saturated
/// logos would be the loudest thing on it. The shapes stay recognisable; the
/// colour does not compete.
class ProviderGlyph extends StatelessWidget {
  const ProviderGlyph({
    super.key,
    required this.brand,
    this.size = 13,
    this.color = const Color(0xFFFFFFFF),
  });

  final AuthBrand brand;
  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return switch (brand) {
      // Apple's mark ships with Material Icons, so it is the real silhouette
      // rather than one traced by hand.
      AuthBrand.apple => Icon(
        Icons.apple,
        size: size + 3,
        color: color,
      ),
      AuthBrand.google => CustomPaint(
        size: Size.square(size),
        painter: _GooglePainter(color),
      ),
      AuthBrand.meta => CustomPaint(
        size: Size.square(size + 1),
        painter: _MetaPainter(color),
      ),
      AuthBrand.passkey => CustomPaint(
        size: Size.square(size + 1),
        painter: _PasskeyPainter(color),
      ),
    };
  }
}

/// A passkey: a keyhole ring with a stepped shaft running out of it, matching
/// the authoritative design's own glyph.
class _PasskeyPainter extends CustomPainter {
  const _PasskeyPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.8 * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    canvas.drawCircle(Offset(9.2 * s, 9.6 * s), 4.4 * s, paint);
    canvas.drawLine(Offset(12.4 * s, 12.8 * s), Offset(19 * s, 19.4 * s), paint);
    canvas.drawLine(Offset(16.4 * s, 16.8 * s), Offset(18 * s, 15.2 * s), paint);
    canvas.drawLine(Offset(18.2 * s, 18.6 * s), Offset(19.6 * s, 17.2 * s), paint);
  }

  @override
  bool shouldRepaint(_PasskeyPainter old) => old.color != color;
}

/// The Google G: a near-closed ring opening at three o'clock, with the
/// crossbar running out to meet it.
class _GooglePainter extends CustomPainter {
  const _GooglePainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final centre = Offset(12 * s, 12 * s);
    final stroke = 3.2 * s;
    final radius = 7.6 * s;

    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.butt;

    // From three o'clock, clockwise most of the way round — the gap sits in
    // the upper right, exactly where the letterform opens.
    canvas.drawArc(
      Rect.fromCircle(center: centre, radius: radius),
      0,
      math.pi * 1.72,
      false,
      paint,
    );

    // The crossbar, meeting the arc's terminal.
    canvas.drawLine(
      Offset(11.6 * s, 12 * s),
      Offset((12 + 7.6) * s, 12 * s),
      paint,
    );
  }

  @override
  bool shouldRepaint(_GooglePainter old) => old.color != color;
}

/// Meta's mark: one continuous ribbon through two lobes.
class _MetaPainter extends CustomPainter {
  const _MetaPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 24;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.4 * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final path = Path()
      ..moveTo(12 * s, 12 * s)
      // Left lobe, anticlockwise from the crossing.
      ..cubicTo(10.1 * s, 8.6 * s, 8.6 * s, 7.1 * s, 6.9 * s, 7.1 * s)
      ..cubicTo(4.8 * s, 7.1 * s, 3.3 * s, 9.3 * s, 3.3 * s, 12 * s)
      ..cubicTo(3.3 * s, 14.7 * s, 4.8 * s, 16.9 * s, 6.9 * s, 16.9 * s)
      ..cubicTo(8.6 * s, 16.9 * s, 10.1 * s, 15.4 * s, 12 * s, 12 * s)
      // Right lobe, closing the ribbon back through the crossing.
      ..cubicTo(13.9 * s, 8.6 * s, 15.4 * s, 7.1 * s, 17.1 * s, 7.1 * s)
      ..cubicTo(19.2 * s, 7.1 * s, 20.7 * s, 9.3 * s, 20.7 * s, 12 * s)
      ..cubicTo(20.7 * s, 14.7 * s, 19.2 * s, 16.9 * s, 17.1 * s, 16.9 * s)
      ..cubicTo(15.4 * s, 16.9 * s, 13.9 * s, 15.4 * s, 12 * s, 12 * s);

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(_MetaPainter old) => old.color != color;
}
