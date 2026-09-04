import 'package:flutter/widgets.dart';

import 'nexa_colors.dart';

export 'nexa_colors.dart';
export 'nexa_typography.dart';

/// The spacing scale. Stage 1 names six steps and the design uses no others
/// for structural rhythm.
abstract final class NexaSpace {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 20.0;
  static const xl = 32.0;
  static const xxl = 56.0;
}

/// Corner radii. Each has one job.
abstract final class NexaRadius {
  /// Controls.
  static const control = Radius.circular(12);

  /// Cards.
  static const card = Radius.circular(16);

  /// Glass panels.
  static const glass = Radius.circular(20);

  /// Sheets.
  static const sheet = Radius.circular(28);

  /// Buttons and pills — fully round.
  static const pill = Radius.circular(999);

  static const cardAll = BorderRadius.all(card);
  static const glassAll = BorderRadius.all(glass);
  static const sheetAll = BorderRadius.all(sheet);
  static const pillAll = BorderRadius.all(pill);

  /// The rounded rows the app groups into a single card (18px, between
  /// [card] and [glass] — the app screens use this consistently).
  static const groupAll = BorderRadius.all(Radius.circular(18));

  /// The phone frame itself.
  static const frameAll = BorderRadius.all(Radius.circular(44));
}

/// Motion. Stage 1 specifies one transition curve and a handful of tempos;
/// everything that moves on a Nexa surface uses these.
abstract final class NexaMotion {
  /// The one UI curve.
  static const curve = Cubic(0.2, 0.8, 0.2, 1.0);

  /// The sharper curve the app uses for screen changes and press states.
  static const enter = Cubic(0.32, 0.72, 0.0, 1.0);

  /// A press acknowledgement. Short enough that the control answers the
  /// finger rather than reporting to it afterwards.
  static const press = Duration(milliseconds: 100);

  /// The release back to rest — nothing is waiting on it.
  static const release = Duration(milliseconds: 200);

  /// UI transition band: 240–420ms.
  static const fast = Duration(milliseconds: 240);
  static const medium = Duration(milliseconds: 320);
  static const slow = Duration(milliseconds: 420);

  /// Idle presence — the mark breathing.
  static const breatheIdle = Duration(seconds: 7);

  /// Presence while Nexa listens.
  static const breatheListening = Duration(milliseconds: 2200);

  /// Presence while Nexa speaks.
  static const breatheSpeaking = Duration(milliseconds: 1600);

  /// The slow drift that keeps the mark from ever sitting still.
  static const float = Duration(seconds: 13);

  /// The halo behind the mark.
  static const halo = Duration(seconds: 8);

  /// The listening ring.
  static const wave = Duration(milliseconds: 2400);

  /// Stagger between items in an entering list.
  static const stagger = Duration(milliseconds: 55);

  /// The same duration, or nothing at all when motion has been asked to stand
  /// down. Every animated widget in the app runs its duration through this.
  static Duration hold(Duration d, bool reduced) => reduced ? Duration.zero : d;
}

/// Surface recipes — the two containers Stage 1 names. Both take the palette
/// in scope, because the same recipe has to hold on either ground.
abstract final class NexaSurface {
  /// A card: r16, 1px hairline.
  static BoxDecoration card(
    NexaPalette c, {
    BorderRadius? radius,
    Color? fill,
  }) {
    return BoxDecoration(
      color: fill ?? c.graphite,
      borderRadius: radius ?? NexaRadius.cardAll,
      border: Border.all(color: c.hairline, width: 1),
    );
  }

  /// Glass: r20, a gradient wash, a 1px border.
  ///
  /// The backdrop blur is not part of the decoration — wrap the panel in a
  /// [BackdropFilter] where the surface actually sits over content.
  static BoxDecoration glass(NexaPalette c, {BorderRadius? radius}) {
    return BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [c.glassFill, c.glassFill.withValues(alpha: 0.02)],
      ),
      borderRadius: radius ?? NexaRadius.glassAll,
      border: Border.all(color: c.glassBorder, width: 1),
    );
  }
}

/// The Nexa mark, in its four materials.
enum NexaMarkMaterial {
  /// Nexa's own presence.
  emerald('assets/marks/mark-emerald.png'),

  /// Speech.
  silver('assets/marks/mark-silver.png'),

  /// Surfaces and dormant states.
  graphite('assets/marks/mark-graphite.png'),

  /// Device contexts.
  stealthBlack('assets/marks/mark-stealth-black.png');

  const NexaMarkMaterial(this.asset);

  final String asset;
}
