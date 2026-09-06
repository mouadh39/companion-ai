import 'package:flutter/widgets.dart';

/// The Nexa palette.
///
/// Stage 1 named two families and nothing else: a near-black environment, and
/// a single emerald light source. That is still the whole system — what
/// changed is that the environment now has two settings.
///
/// **Dark is the identity**: near-black ground, emerald presence, hairline
/// borders. **Light is the same system on a warm off-white ground**: the ink
/// scale inverts, the emerald steps down to a readable weight, and the glow
/// pulls back, because a bloom that reads as light on black reads as dirt on
/// white. No token exists in one mode and not the other, so a widget written
/// against the palette is correct in both without knowing which it is in.
@immutable
class NexaPalette {
  const NexaPalette({
    required this.brightness,
    required this.void_,
    required this.base,
    required this.graphite,
    required this.raised,
    required this.card,
    required this.cardTop,
    required this.cardBottom,
    required this.groundTop,
    required this.emeraldDeep,
    required this.emeraldCore,
    required this.emerald,
    required this.emeraldBright,
    required this.emeraldHighlight,
    required this.ink,
    required this.inkButton,
    required this.onInk,
    required this.danger,
    required this.ink90,
    required this.ink86,
    required this.ink82,
    required this.ink72,
    required this.ink62,
    required this.ink55,
    required this.ink52,
    required this.ink50,
    required this.ink48,
    required this.ink45,
    required this.ink42,
    required this.ink40,
    required this.ink36,
    required this.ink34,
    required this.ink32,
    required this.ink30,
    required this.hairline,
    required this.hairlineStrong,
    required this.glassBorder,
    required this.glassFill,
    required this.surfaceQuiet,
    required this.surfaceLift,
    required this.group,
    required this.emeraldWash,
    required this.emeraldBorder,
    required this.illustrationInk,
    required this.shadow,
    required this.frameShadow,
    required this.glowScale,
    required this.chrome,
  });

  final Brightness brightness;

  bool get isDark => brightness == Brightness.dark;

  // ---------------------------------------------------------------------
  // Environment — the ground everything sits on.
  // ---------------------------------------------------------------------

  /// The deepest ground. Full-bleed backgrounds and device frames.
  final Color void_;

  /// The default surface behind content.
  final Color base;

  /// Cards and grouped rows.
  final Color graphite;

  /// A card lifted above graphite.
  final Color raised;

  /// The card fill used throughout the app screens.
  final Color card;

  /// The two ends of a product card's vertical gradient.
  final Color cardTop;
  final Color cardBottom;

  /// The lit end of a screen's background gradient.
  final Color groundTop;

  // ---------------------------------------------------------------------
  // Light — emerald only. Nexa's presence is the only thing that glows.
  // ---------------------------------------------------------------------

  /// The deepest bloom behind the mark.
  final Color emeraldDeep;

  /// Ambient glow at the horizon.
  final Color emeraldCore;

  /// The accent. Kickers, active states, the live dot.
  final Color emerald;

  /// Emerald at a weight that reads as text on this ground.
  final Color emeraldBright;

  /// Secondary marks on emerald surfaces.
  final Color emeraldHighlight;

  // ---------------------------------------------------------------------
  // Ink.
  // ---------------------------------------------------------------------

  /// Display and headline text.
  final Color ink;

  /// The primary button fill — always the inverse of the ground.
  final Color inkButton;

  /// Text on a primary button.
  final Color onInk;

  /// The one warm colour in the system: destructive rows only.
  final Color danger;

  // ---------------------------------------------------------------------
  // Ink at opacity. The design specifies text as a percentage rather than as
  // flat colours; these are the exact steps it uses, inverted for light.
  // ---------------------------------------------------------------------

  final Color ink90;
  final Color ink86;
  final Color ink82;
  final Color ink72;
  final Color ink62;
  final Color ink55;
  final Color ink52;
  final Color ink50;
  final Color ink48;
  final Color ink45;
  final Color ink42;
  final Color ink40;
  final Color ink36;
  final Color ink34;
  final Color ink32;
  final Color ink30;

  // ---------------------------------------------------------------------
  // Hairlines, glass and quiet fills.
  // ---------------------------------------------------------------------

  /// The card border.
  final Color hairline;

  /// A slightly stronger divider.
  final Color hairlineStrong;

  final Color glassBorder;
  final Color glassFill;

  /// The barely-there fill under a quiet control.
  final Color surfaceQuiet;

  /// One step up from [surfaceQuiet].
  final Color surfaceLift;

  /// The fill of a grouped-rows card ([NexaGroup]). Deliberately its own
  /// token, distinct from the glass wash: the design's `--group` is a nearly
  /// solid near-white on the light ground (r 255 @ .86) and a *quieter* wash
  /// than glass on the dark ground (white @ .045), because a settings list is
  /// a solid card with hairlines, not a floating pane — glass is reserved for
  /// things that actually float.
  final Color group;

  /// Emerald wash behind an emerald-bordered control, and its border.
  final Color emeraldWash;
  final Color emeraldBorder;

  /// The supplied line drawings are dark ink on transparency. This is what
  /// they are tinted to so they read on the current ground.
  final Color illustrationInk;

  final List<BoxShadow> shadow;
  final List<BoxShadow> frameShadow;

  /// How much of the mark's specified bloom to actually draw. A glow that
  /// reads as light on near-black reads as grime on off-white.
  final double glowScale;

  /// The floating tab bar's own fill — translucent, because it sits on glass
  /// over whatever is scrolling underneath it.
  final Color chrome;

  /// The same palette with its edges drawn in and its glass made solid, for
  /// a reader who has asked the platform for more contrast. Hairlines are the
  /// first thing to disappear on a low-contrast screen, so they are what has
  /// to strengthen.
  NexaPalette forHighContrast() {
    final edge = isDark ? const Color(0x66FFFFFF) : const Color(0x8A000000);
    return NexaPalette(
      brightness: brightness,
      void_: void_,
      base: base,
      graphite: graphite,
      raised: raised,
      card: card,
      cardTop: cardTop,
      cardBottom: cardBottom,
      groundTop: groundTop,
      emeraldDeep: emeraldDeep,
      emeraldCore: emeraldCore,
      emerald: emerald,
      emeraldBright: emeraldBright,
      emeraldHighlight: emeraldHighlight,
      ink: ink,
      inkButton: inkButton,
      onInk: onInk,
      danger: danger,
      // Quiet text steps up; the loud ones are already loud enough.
      ink90: ink90, ink86: ink86, ink82: ink82, ink72: ink82,
      ink62: ink82, ink55: ink72, ink52: ink72, ink50: ink72,
      ink48: ink72, ink45: ink72, ink42: ink62, ink40: ink62,
      ink36: ink62, ink34: ink62, ink32: ink62, ink30: ink62,
      hairline: edge,
      hairlineStrong: edge,
      glassBorder: edge,
      glassFill: glassFill,
      surfaceQuiet: surfaceQuiet,
      surfaceLift: surfaceLift,
      group: group,
      emeraldWash: emeraldWash,
      emeraldBorder: emerald,
      illustrationInk: illustrationInk,
      shadow: shadow,
      frameShadow: frameShadow,
      glowScale: glowScale,
      // Translucent chrome over moving content is the other thing that costs
      // contrast, so it goes solid.
      chrome: isDark ? const Color(0xFF0B0E12) : const Color(0xFFFFFFFF),
    );
  }

  /// The identity: near-black, emerald, hairlines.
  static const dark = NexaPalette(
    brightness: Brightness.dark,
    void_: Color(0xFF040507),
    base: Color(0xFF0A0C10),
    graphite: Color(0xFF12151A),
    raised: Color(0xFF1D2127),
    card: Color(0xFF0B0E12),
    cardTop: Color(0xFF151A1F),
    cardBottom: Color(0xFF0A0D11),
    groundTop: Color(0xFF0A0E12),
    emeraldDeep: Color(0xFF0B3A28),
    emeraldCore: Color(0xFF12805A),
    emerald: Color(0xFF4ADE9B),
    emeraldBright: Color(0xFF7FF0BE),
    emeraldHighlight: Color(0xFFA7F3D0),
    ink: Color(0xFFF3F7F4),
    inkButton: Color(0xFFEDF2EE),
    onInk: Color(0xFF06070A),
    danger: Color(0xFFF0A08A),
    ink90: Color(0xE6FFFFFF),
    ink86: Color(0xDBFFFFFF),
    ink82: Color(0xD1FFFFFF),
    ink72: Color(0xB8FFFFFF),
    ink62: Color(0x9EFFFFFF),
    ink55: Color(0x8CFFFFFF),
    ink52: Color(0x85FFFFFF),
    ink50: Color(0x80FFFFFF),
    ink48: Color(0x7AFFFFFF),
    ink45: Color(0x73FFFFFF),
    ink42: Color(0x6BFFFFFF),
    ink40: Color(0x66FFFFFF),
    ink36: Color(0x5CFFFFFF),
    ink34: Color(0x57FFFFFF),
    ink32: Color(0x52FFFFFF),
    ink30: Color(0x4DFFFFFF),
    hairline: Color(0x12FFFFFF),
    hairlineStrong: Color(0x1AFFFFFF),
    glassBorder: Color(0x24FFFFFF),
    glassFill: Color(0x0FFFFFFF),
    surfaceQuiet: Color(0x0BFFFFFF),
    surfaceLift: Color(0x14FFFFFF),
    group: Color(0x0BFFFFFF),
    emeraldWash: Color(0x1F4ADE9B),
    emeraldBorder: Color(0x594ADE9B),
    illustrationInk: Color(0xFFDCE8E1),
    chrome: Color(0xB8101418),
    shadow: <BoxShadow>[
      BoxShadow(color: Color(0x99000000), blurRadius: 60, offset: Offset(0, 24)),
    ],
    frameShadow: <BoxShadow>[
      BoxShadow(color: Color(0xBF000000), blurRadius: 80, offset: Offset(0, 30)),
    ],
    glowScale: 1.0,
  );

  /// The same system on a cool, atmospheric off-white ground — frosted
  /// glass floating in soft light, not a flat white page. `void_` is the
  /// package's own reference tone (`#F3F4F8`); every card and pill still
  /// reads as white, just translucent enough that this ground shows through
  /// at the edges, which is what makes them read as glass rather than paper.
  static const light = NexaPalette(
    brightness: Brightness.light,
    // The authoritative DesignSync LIGHT ground: a warm green-tinted
    // off-white (`--void #EDF2EE`), not the cool blue-grey this used to be.
    void_: Color(0xFFEDF2EE),
    base: Color(0xFFF7FAF7),
    graphite: Color(0xFFFFFFFF),
    raised: Color(0xFFFFFFFF),
    card: Color(0xFFFFFFFF),
    cardTop: Color(0xFFFFFFFF),
    cardBottom: Color(0xFFF1F4F1),
    groundTop: Color(0xFFFAFCFA),
    emeraldDeep: Color(0xFFD3F1E2),
    emeraldCore: Color(0xFF12805A),
    emerald: Color(0xFF12805A),
    emeraldBright: Color(0xFF0B6242),
    emeraldHighlight: Color(0xFF0B3A28),
    ink: Color(0xFF0E1211),
    inkButton: Color(0xFF14181B),
    onInk: Color(0xFFF7FAF8),
    danger: Color(0xFFB0402A),
    // Quiet ink steps step *up* on the light ground versus the dark one —
    // the authoritative maps do this so muted metadata still reads on white.
    ink90: Color(0xE60E1211),
    ink86: Color(0xDB0E1211),
    ink82: Color(0xD10E1211),
    ink72: Color(0xB80E1211),
    ink62: Color(0xA80E1211),
    ink55: Color(0x940E1211),
    ink52: Color(0x8F0E1211),
    ink50: Color(0x8C0E1211),
    ink48: Color(0x890E1211),
    ink45: Color(0x850E1211),
    ink42: Color(0x800E1211),
    ink40: Color(0x7D0E1211),
    ink36: Color(0x750E1211),
    ink34: Color(0x750E1211),
    ink32: Color(0x700E1211),
    ink30: Color(0x6B0E1211),
    hairline: Color(0x14000000),
    hairlineStrong: Color(0x1A000000),
    glassBorder: Color(0x1A000000),
    glassFill: Color(0x0C000000),
    surfaceQuiet: Color(0x0B0E1211),
    surfaceLift: Color(0x0F000000),
    group: Color(0xDBFFFFFF),
    emeraldWash: Color(0x1712805A),
    emeraldBorder: Color(0x4D12805A),
    illustrationInk: Color(0xFF2B322F),
    chrome: Color(0xDBFFFFFF),
    shadow: <BoxShadow>[
      BoxShadow(color: Color(0x14000000), blurRadius: 40, offset: Offset(0, 16)),
    ],
    frameShadow: <BoxShadow>[
      BoxShadow(color: Color(0x24000000), blurRadius: 60, offset: Offset(0, 24)),
    ],
    glowScale: 0.42,
  );
}

/// How the app picks its palette.
enum ThemeChoice {
  system('System', 'Follow the device.'),
  light('Light', 'Warm off-white, always.'),
  dark('Dark', 'Near-black, always.');

  const ThemeChoice(this.label, this.note);

  final String label;
  final String note;
}

/// Carries the resolved palette, and whether motion has been asked to stand
/// down, to every widget below it.
class NexaAppearance extends InheritedWidget {
  const NexaAppearance({
    super.key,
    required this.palette,
    required this.reducedMotion,
    required super.child,
  });

  final NexaPalette palette;

  /// True when the user has asked for reduced motion, or the platform has.
  final bool reducedMotion;

  static NexaAppearance of(BuildContext context) {
    final a = context.dependOnInheritedWidgetOfExactType<NexaAppearance>();
    assert(a != null, 'No NexaAppearance above this widget.');
    return a!;
  }

  @override
  bool updateShouldNotify(NexaAppearance old) =>
      old.palette != palette || old.reducedMotion != reducedMotion;
}

/// The palette in scope. Written as `NexaColors.of(context)` so call sites
/// read the way they did when there was only one.
abstract final class NexaColors {
  static NexaPalette of(BuildContext context) =>
      NexaAppearance.of(context).palette;

  /// Whether motion should stand down here.
  static bool reducedMotion(BuildContext context) =>
      NexaAppearance.of(context).reducedMotion;
}
