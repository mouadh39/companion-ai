import 'package:flutter/widgets.dart';

import '../theme/nexa_theme.dart';
import 'nexa_controls.dart';
import 'nexa_glass.dart';
import 'nexa_icons.dart';

/// The atmospheric ground every content screen sits on: the same radial wash
/// the assistant and onboarding surfaces use, plus two soft, static emerald
/// blooms placed off-centre so a settings list reads as a space with depth
/// rather than a flat page. No animation runs here — a screen that scrolls
/// under it should never pay for a controller it does not need; the mark's
/// own breathing is what carries life on the screens that show it.
class NexaAtmosphere extends StatelessWidget {
  const NexaAtmosphere({super.key, this.child});

  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.62),
          radius: 1.15,
          colors: [c.groundTop, c.void_],
          stops: const [0.0, 0.78],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned(
            top: -140,
            right: -90,
            child: _Bloom(size: 320, opacity: c.isDark ? 0.10 : 0.16),
          ),
          Positioned(
            bottom: -170,
            left: -110,
            child: _Bloom(size: 380, opacity: c.isDark ? 0.06 : 0.10),
          ),
          if (child != null) child!,
        ],
      ),
    );
  }
}

class _Bloom extends StatelessWidget {
  const _Bloom({required this.size, required this.opacity});

  final double size;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [
              c.emerald.withValues(alpha: opacity),
              c.emerald.withValues(alpha: 0),
            ],
          ),
        ),
      ),
    );
  }
}

/// The standard shape of a Nexa screen: a title that stays put while the body
/// scrolls under it, on the app's atmospheric ground, with the paddings the
/// design specifies.
///
/// Everything below the assistant uses this, which is what keeps twenty
/// screens feeling like one app rather than twenty.
class NexaPage extends StatelessWidget {
  const NexaPage({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.onBack,
    this.trailing,
    this.bottomPadding = 130,
    this.background,
  });

  final String title;
  final String? subtitle;

  /// Omit to leave the header without a back affordance — the tab roots do.
  final VoidCallback? onBack;

  /// An optional control on the right of the title row.
  final Widget? trailing;

  final List<Widget> children;
  final double bottomPadding;

  /// Overrides the atmospheric ground with something else — the loading and
  /// error scaffolds want a plain surface with nothing floating behind it.
  final Decoration? background;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final body = SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(28, onBack == null ? 56 : 46, 28, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (onBack != null) ...[
                    NexaBackButton(onTap: onBack, size: 20),
                    const SizedBox(height: 10),
                  ],
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: NexaType.display(size: 27)
                              .copyWith(height: 1.15),
                        ),
                      ),
                      if (trailing != null) trailing!,
                    ],
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 7),
                    Text(
                      subtitle!,
                      style: NexaType.body(
                        size: 14,
                        color: c.ink45,
                      ).copyWith(height: 1.45),
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              // The body scrolls behind a fixed title, so without this the
              // first card is guillotined on a hard line under the subtitle.
              // A short fade lets it dissolve into the header instead.
              child: ShaderMask(
                shaderCallback: (rect) => const LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x00000000), Color(0xFF000000)],
                  stops: [0.0, 0.028],
                ).createShader(rect),
                blendMode: BlendMode.dstIn,
                child: ListView(
                  padding: EdgeInsets.fromLTRB(28, 8, 28, bottomPadding),
                  children: children,
                ),
              ),
            ),
          ],
        ),
      );

    if (background != null) {
      return DecoratedBox(decoration: background!, child: body);
    }
    return NexaAtmosphere(child: body);
  }
}

/// The small uppercase label above a group.
class NexaSectionLabel extends StatelessWidget {
  const NexaSectionLabel(this.text, {super.key, this.topPadding = 0});

  final String text;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Padding(
      padding: EdgeInsets.only(top: topPadding, bottom: 10),
      child: Text(
        text.toUpperCase(),
        style: NexaType.label(
          size: 10,
          tracking: 0.24,
          color: c.ink30,
        ),
      ),
    );
  }
}

/// A group of rows on one floating pane of glass, hairlines between them —
/// the shape every grouped-settings list in the app takes, over the
/// atmosphere [NexaPage] now paints behind it.
class NexaGroup extends StatelessWidget {
  const NexaGroup({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaGlassSurface(
      radius: NexaRadius.groupAll,
      blur: 16,
      // A grouped list is a solid card with hairlines, not a floating pane —
      // the design's `--group` fill and its `--hairline-strong` edge, not the
      // glass wash. Glass stays reserved for surfaces that actually float.
      tint: c.group,
      borderColor: c.hairlineStrong,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0)
              SizedBox(
                height: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(color: c.surfaceLift),
                ),
              ),
            children[i],
          ],
        ],
      ),
    );
  }
}

/// One row: an optional icon, a label, an optional value, an optional
/// chevron.
class NexaRow extends StatelessWidget {
  const NexaRow({
    super.key,
    required this.label,
    this.icon,
    this.value,
    this.note,
    this.onTap,
    this.danger = false,
    this.trailing,
  });

  final String label;

  /// The small glyph in a quiet circle to the left — see [NexaGlyph]. `null`
  /// for a row that reads fine on its own (most confirmation/summary rows);
  /// most settings-tree rows carry one, matching the reference design's own
  /// icon-per-row rhythm.
  final NexaIcon? icon;
  final String? value;

  /// A second line under the label, for a row that needs explaining.
  final String? note;

  final VoidCallback? onTap;
  final bool danger;

  /// Replaces the value and chevron — a switch, usually.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final row = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      child: Row(
        children: [
          if (icon != null) ...[
            Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: danger ? c.danger.withValues(alpha: 0.12) : c.surfaceQuiet,
                shape: BoxShape.circle,
              ),
              child: NexaGlyph(
                icon!,
                size: 16,
                color: danger ? c.danger : c.ink55,
              ),
            ),
            const SizedBox(width: 14),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: NexaType.ui(
                    size: 14.5,
                    color: danger ? c.danger : c.ink86,
                  ),
                ),
                if (note != null) ...[
                  const SizedBox(height: 5),
                  Text(
                    note!,
                    style: NexaType.body(
                      size: 12,
                      color: c.ink36,
                    ).copyWith(height: 1.5),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null)
            trailing!
          else ...[
            if (value != null)
              Padding(
                padding: const EdgeInsets.only(left: 12),
                child: Text(
                  value!,
                  style: NexaType.ui(size: 12.5, color: c.ink34),
                ),
              ),
            if (onTap != null)
              Padding(
                padding: const EdgeInsets.only(left: 10),
                child: Text(
                  '›',
                  style: NexaType.ui(size: 14, color: c.ink30),
                ),
              ),
          ],
        ],
      ),
    );

    if (onTap == null) return row;
    return NexaPressable(onTap: onTap, scale: 0.995, child: row);
  }
}

/// A switch in Nexa's vocabulary: a quiet track that lights emerald when on.
class NexaSwitch extends StatelessWidget {
  const NexaSwitch({super.key, required this.value, this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onChanged == null ? null : () => onChanged!(!value),
      child: SizedBox(
        // The visible track is 42×24, but the target clears 44.
        width: 44,
        height: 44,
        child: Center(
          child: AnimatedContainer(
            duration: NexaMotion.fast,
            curve: NexaMotion.curve,
            width: 42,
            height: 24,
            padding: const EdgeInsets.all(3),
            alignment:
                value ? Alignment.centerRight : Alignment.centerLeft,
            decoration: BoxDecoration(
              color: value
                  ? c.emeraldWash
                  : c.surfaceLift,
              borderRadius: NexaRadius.pillAll,
              border: Border.all(
                color: value
                    ? c.emeraldBorder
                    : c.glassBorder,
                width: 1,
              ),
            ),
            child: AnimatedContainer(
              duration: NexaMotion.fast,
              curve: NexaMotion.curve,
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: value ? c.emerald : c.ink50,
                shape: BoxShape.circle,
                boxShadow: value
                    ? [
                        BoxShadow(
                          color: c.emerald.withValues(alpha: 0.6),
                          blurRadius: 12,
                        ),
                      ]
                    : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A row whose value is a switch.
class NexaToggleRow extends StatelessWidget {
  const NexaToggleRow({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.note,
    this.onChanged,
  });

  final String label;
  final NexaIcon? icon;
  final String? note;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return NexaRow(
      label: label,
      icon: icon,
      note: note,
      trailing: NexaSwitch(value: value, onChanged: onChanged),
    );
  }
}

/// The live dot beside a status word.
class NexaStatusDot extends StatelessWidget {
  const NexaStatusDot({super.key, required this.color, this.glow = true});

  final Color color;
  final bool glow;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 6,
      height: 6,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        boxShadow: glow
            ? [BoxShadow(color: color.withValues(alpha: 0.85), blurRadius: 9)]
            : null,
      ),
    );
  }
}

/// A quiet full-width bordered action — the shape used under a list.
class NexaOutlineButton extends StatelessWidget {
  const NexaOutlineButton({
    super.key,
    required this.label,
    this.onTap,
    this.danger = false,
  });

  final String label;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 15),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: NexaRadius.pillAll,
          border: Border.all(
            color: danger ? c.danger.withValues(alpha: 0.24) : c.glassBorder,
            width: 1,
          ),
        ),
        child: Text(
          label,
          style: NexaType.ui(
            size: 13.5,
            color: danger ? c.danger : c.ink72,
          ),
        ),
      ),
    );
  }
}
