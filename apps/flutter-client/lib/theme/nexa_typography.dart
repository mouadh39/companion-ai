import 'package:flutter/widgets.dart';

/// The Nexa type ramp — Satoshi, four roles, nothing else.
///
/// Stage 1 names exactly four: the brandmark, display, body, and label. Every
/// piece of text on a Nexa surface is one of them, at the tracking and weight
/// specified here.
///
/// Colour is not baked in. The ramp has to hold on a near-black ground and on
/// a warm off-white one, so a caller either names a palette step or leaves
/// [Color] null and inherits the surrounding [DefaultTextStyle], which the app
/// sets to the current palette's ink.
abstract final class NexaType {
  /// Satoshi is not vendored — see the note in pubspec.yaml. Until the files
  /// are dropped in, `null` resolves to the platform sans, which carries
  /// similar metrics, so the layout holds. Flip this to `'Satoshi'` in the
  /// same change that uncomments the pubspec font block.
  static const String? fontFamily = null;

  /// The wordmark. Light, wide, uppercase — never set below 12px.
  ///
  /// Tracking is .52em on device screens and .44em on the foundation sheet;
  /// [size] drives the letter-spacing so both stay proportional.
  static TextStyle brand(
      {double size = 15, double tracking = 0.52, Color? color}) {
    return TextStyle(
      fontFamily: fontFamily,
      fontWeight: FontWeight.w300,
      fontSize: size,
      letterSpacing: size * tracking,
      height: 1.0,
      color: color,
    );
  }

  /// Display — the one big line on a screen. 30–40px, -2% tracking.
  static TextStyle display({double size = 32, Color? color}) {
    return TextStyle(
      fontFamily: fontFamily,
      fontWeight: FontWeight.w400,
      fontSize: size,
      letterSpacing: size * -0.02,
      height: 1.15,
      color: color,
    );
  }

  /// Body — quiet and spacious. 15/23 at 62% white, two sentences at most.
  static TextStyle body({double size = 15, Color? color}) {
    return TextStyle(
      fontFamily: fontFamily,
      fontWeight: FontWeight.w400,
      fontSize: size,
      height: 1.55,
      color: color,
    );
  }

  /// Label — the small uppercase kicker. Medium 500, .2em tracking.
  static TextStyle label({
    double size = 11,
    double tracking = 0.2,
    Color? color,
    FontWeight weight = FontWeight.w500,
  }) {
    return TextStyle(
      fontFamily: fontFamily,
      fontWeight: weight,
      fontSize: size,
      letterSpacing: size * tracking,
      height: 1.2,
      color: color,
    );
  }

  /// Interface text that is neither display nor body — button faces, row
  /// labels, field values.
  static TextStyle ui({
    double size = 15,
    FontWeight weight = FontWeight.w400,
    Color? color,
    double? height,
  }) {
    return TextStyle(
      fontFamily: fontFamily,
      fontWeight: weight,
      fontSize: size,
      height: height,
      color: color,
    );
  }
}
