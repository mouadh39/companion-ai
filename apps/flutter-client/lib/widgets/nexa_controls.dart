import 'dart:async';

import 'package:flutter/material.dart';

import '../theme/nexa_theme.dart';

/// Press feedback. The design scales a control down a hair on press rather
/// than tinting it — the surface stays the colour it was, and only the
/// geometry acknowledges the touch.
class NexaPressable extends StatefulWidget {
  const NexaPressable({
    super.key,
    required this.child,
    this.onTap,
    this.scale = 0.972,
  });

  final Widget child;
  final VoidCallback? onTap;
  final double scale;

  @override
  State<NexaPressable> createState() => _NexaPressableState();
}

class _NexaPressableState extends State<NexaPressable> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.onTap,
      onTapDown: enabled ? (_) => _set(true) : null,
      onTapUp: enabled ? (_) => _set(false) : null,
      onTapCancel: enabled ? () => _set(false) : null,
      // Going down is the acknowledgement, so it has to be immediate; coming
      // back up is just tidying, so it can take its time. One duration for
      // both made every control feel a beat late.
      child: AnimatedScale(
        scale: _down ? widget.scale : 1.0,
        duration: _down ? NexaMotion.press : NexaMotion.release,
        curve: NexaMotion.enter,
        child: widget.child,
      ),
    );
  }
}

/// The primary action. One per screen, near-white on near-black.
class NexaPrimaryButton extends StatelessWidget {
  const NexaPrimaryButton({
    super.key,
    required this.label,
    this.onTap,
    this.trailing,
    this.busy = false,
  });

  final String label;
  final VoidCallback? onTap;

  /// The arrow the welcome and pairing CTAs carry.
  final String? trailing;

  /// Shows a small spinner before the label and holds the button at a
  /// working opacity — for an action that has been submitted and is waiting
  /// on the network.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      child: AnimatedOpacity(
        // Without an action the button is not gone, it is not yet available —
        // it dims rather than disappearing, so the layout does not jump.
        duration: NexaMotion.medium,
        opacity: onTap == null ? (busy ? 0.66 : 0.32) : 1,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 17),
          decoration: BoxDecoration(
            color: c.inkButton,
            borderRadius: NexaRadius.pillAll,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (busy) ...[
                _Spinner(color: c.onInk),
                const SizedBox(width: 10),
              ],
              // The label can be a name the user typed, so it has to survive
              // being longer than the button.
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: NexaType.ui(
                    size: 15,
                    weight: FontWeight.w500,
                    color: c.onInk,
                  ),
                ),
              ),
              if (trailing != null && !busy) ...[
                const SizedBox(width: 10),
                Text(
                  trailing!,
                  style: NexaType.ui(size: 15, color: c.onInk),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A small indeterminate ring — the one spinner in the app, on a busy
/// primary button.
class _Spinner extends StatefulWidget {
  const _Spinner({required this.color});

  final Color color;

  @override
  State<_Spinner> createState() => _SpinnerState();
}

class _SpinnerState extends State<_Spinner> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 800),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduced = NexaColors.reducedMotion(context);
    if (reduced && _c.isAnimating) {
      _c.stop();
    } else if (!reduced && !_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ring = SizedBox(
      width: 14,
      height: 14,
      child: CustomPaint(painter: _RingPainter(widget.color)),
    );
    if (NexaColors.reducedMotion(context)) return ring;
    return RotationTransition(turns: _c, child: ring);
  }
}

class _RingPainter extends CustomPainter {
  const _RingPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    // Three-quarters of a ring, so the rotation reads.
    canvas.drawArc(
      Offset.zero & size,
      -1.2,
      4.7,
      false,
      paint,
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.color != color;
}

/// The quiet alternative under a primary action — text only, no container.
class NexaQuietButton extends StatelessWidget {
  const NexaQuietButton({
    super.key,
    required this.label,
    this.onTap,
    this.padding = 16,
    this.color,
    this.size = 14,
  });

  final String label;
  final VoidCallback? onTap;
  final double padding;

  /// Defaults to the palette's quiet ink.
  final Color? color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(vertical: padding),
        alignment: Alignment.center,
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: NexaType.ui(size: size, color: color ?? c.ink55),
        ),
      ),
    );
  }
}

/// The emerald control — used where the action is about Nexa's own presence
/// rather than about navigating.
class NexaEmeraldButton extends StatelessWidget {
  const NexaEmeraldButton({super.key, required this.label, this.onTap});

  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 16),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: c.emeraldWash,
          borderRadius: NexaRadius.pillAll,
          border: Border.all(color: c.emeraldBorder, width: 1),
        ),
        child: Text(
          label,
          style: NexaType.ui(
            size: 14.5,
            weight: FontWeight.w500,
            color: c.emeraldBright,
          ),
        ),
      ),
    );
  }
}

/// A full-width pill row with a label on the left and a hint on the right —
/// the shape the auth screen uses for its alternative sign-in methods.
class NexaPillRow extends StatelessWidget {
  const NexaPillRow({
    super.key,
    required this.label,
    this.trailing,
    this.onTap,
    this.fill,
    this.border,
    this.labelColor,
    this.trailingColor,
    this.labelWeight = FontWeight.w400,
    this.leading,
  });

  final String label;
  final String? trailing;
  final VoidCallback? onTap;
  final Color? fill;
  /// All three default to palette steps.
  final Color? border;
  final Color? labelColor;
  final Color? trailingColor;
  final FontWeight labelWeight;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return NexaPressable(
      onTap: onTap,
      scale: 0.978,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        decoration: BoxDecoration(
          color: fill,
          borderRadius: NexaRadius.pillAll,
          border: Border.all(color: border ?? c.glassBorder, width: 1),
        ),
        child: Row(
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 14)],
            Expanded(
              child: Text(
                label,
                style: NexaType.ui(
                  size: 15,
                  weight: labelWeight,
                  color: labelColor ?? c.ink82,
                ),
              ),
            ),
            if (trailing != null)
              Text(
                trailing!,
                style: NexaType.ui(
                  size: 12.5,
                  color: trailingColor ?? c.ink30,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A back chevron. The design uses a bare arrow glyph at 22px, not an icon.
class NexaBackButton extends StatelessWidget {
  const NexaBackButton({super.key, this.onTap, this.size = 22});

  final VoidCallback? onTap;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: SizedBox(
        // The glyph is 22px but the target must clear 44.
        width: 44,
        height: 44,
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            '←',
            style: NexaType.ui(size: size, color: c.ink45),
          ),
        ),
      ),
    );
  }
}

/// The underlined field the design uses everywhere instead of a boxed input.
class NexaField extends StatelessWidget {
  const NexaField({
    super.key,
    this.label,
    required this.controller,
    this.hint,
    this.keyboardType,
    this.textSize = 20,
    this.prefix,
    this.autofocus = false,
    this.obscureText = false,
    this.onSubmitted,
    this.trailing,
  });

  final String? label;
  final TextEditingController controller;
  final String? hint;
  final TextInputType? keyboardType;
  final double textSize;
  final String? prefix;
  final bool autofocus;

  /// Hides what is typed — a password field's own request. Every existing
  /// field leaves this at its default `false`, so nothing about how they
  /// look or behave changes.
  final bool obscureText;
  final ValueChanged<String>? onSubmitted;

  /// An optional control at the end of the row, alongside the text —
  /// a password field's "Show"/"Hide" toggle, in the design's own bare-text
  /// idiom rather than an icon. `null` for every existing field, so nothing
  /// about how they look changes.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!.toUpperCase(),
            style: NexaType.label(size: 10, color: c.ink34),
          ),
          const SizedBox(height: 8),
        ],
        Container(
          padding: const EdgeInsets.only(bottom: 11),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: c.glassBorder, width: 1),
            ),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              if (prefix != null) ...[
                Text(
                  prefix!,
                  style: NexaType.ui(size: textSize, color: c.ink50),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: TextField(
                  controller: controller,
                  autofocus: autofocus,
                  keyboardType: keyboardType,
                  obscureText: obscureText,
                  onSubmitted: onSubmitted,
                  style: NexaType.ui(size: textSize, color: c.ink),
                  cursorColor: c.emerald,
                  cursorWidth: 1.5,
                  decoration: InputDecoration.collapsed(
                    hintText: hint,
                    hintStyle: NexaType.ui(
                      size: textSize,
                      color: c.ink30,
                    ),
                  ),
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 12),
                trailing!,
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// The design's `nx-in` / `nx-rise` entrance: a short rise with a fade, on the
/// system's one curve. Stagger by passing a [delay].
class NexaRiseIn extends StatefulWidget {
  const NexaRiseIn({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.distance = 10,
    this.duration = const Duration(milliseconds: 900),
  });

  final Widget child;
  final Duration delay;
  final double distance;
  final Duration duration;

  @override
  State<NexaRiseIn> createState() => _NexaRiseInState();
}

class _NexaRiseInState extends State<NexaRiseIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.duration,
  );

  Timer? _stagger;

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _c.forward();
    } else {
      _stagger = Timer(widget.delay, () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _stagger?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (NexaColors.reducedMotion(context)) {
      // No rise, no fade — the content is simply there.
      _stagger?.cancel();
      if (_c.value != 1) _c.value = 1;
      return widget.child;
    }
    final t = CurvedAnimation(parent: _c, curve: NexaMotion.enter);
    return AnimatedBuilder(
      animation: t,
      builder: (context, child) => Opacity(
        opacity: t.value.clamp(0.0, 1.0),
        child: Transform.translate(
          offset: Offset(0, widget.distance * (1 - t.value)),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}
