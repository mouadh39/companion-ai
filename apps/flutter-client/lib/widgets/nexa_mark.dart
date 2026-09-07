import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import '../theme/nexa_theme.dart';

/// The Nexa mark — the one element that carries Nexa's presence.
///
/// It is never static. Idle it breathes on a seven-second cycle; listening and
/// speaking tighten that tempo and widen the bloom. The glow is a blurred,
/// tinted copy of the mark's own silhouette rather than a box shadow, so it
/// follows the artwork's alpha the way the CSS `drop-shadow` in the design
/// does.
class NexaMark extends StatefulWidget {
  const NexaMark({
    super.key,
    this.size = 162,
    this.material = NexaMarkMaterial.emerald,
    this.breathe = NexaMotion.breatheIdle,
    this.glow = 54,
    this.glowOpacity = 0.5,
    this.float,
    this.opacity = 1.0,
  });

  /// The rendered width of the mark.
  final double size;

  /// Which material the mark is cast in.
  final NexaMarkMaterial material;

  /// The breathing period. Shorter reads as more alert.
  final Duration breathe;

  /// The bloom radius, in CSS-equivalent pixels.
  final double glow;

  /// How strong the bloom is.
  final double glowOpacity;

  /// An optional slow drift. Null holds the mark in place.
  final Duration? float;

  /// A flat opacity applied to the whole mark.
  final double opacity;

  @override
  State<NexaMark> createState() => _NexaMarkState();
}

class _NexaMarkState extends State<NexaMark> with TickerProviderStateMixin {
  late AnimationController _breathe;
  AnimationController? _float;

  @override
  void initState() {
    super.initState();
    _breathe = AnimationController(vsync: this, duration: widget.breathe)
      ..repeat(reverse: true);
    _syncFloat();
  }

  @override
  void didUpdateWidget(NexaMark old) {
    super.didUpdateWidget(old);
    if (old.breathe != widget.breathe) {
      // Retune without restarting, so a state change does not make the mark
      // jump back to the start of its cycle.
      _breathe.duration = widget.breathe;
      _breathe.repeat(reverse: true);
    }
    if (old.float != widget.float) _syncFloat();
  }

  void _syncFloat() {
    if (widget.float == null) {
      _float?.dispose();
      _float = null;
      return;
    }
    _float ??= AnimationController(vsync: this);
    _float!
      ..duration = widget.float
      ..repeat(reverse: true);
  }

  @override
  void dispose() {
    _breathe.dispose();
    _float?.dispose();
    super.dispose();
  }

  /// Reduced motion parks every controller at rest rather than removing the
  /// animation, so the mark still has its shape and its glow — it simply
  /// stops moving.
  void _settleForMotion(bool reduced) {
    if (reduced) {
      if (_breathe.isAnimating) _breathe.stop();
      _breathe.value = 0;
      if (_float?.isAnimating ?? false) _float!.stop();
      _float?.value = 0;
    } else if (!_breathe.isAnimating) {
      _breathe.repeat(reverse: true);
      if (widget.float != null && !(_float?.isAnimating ?? false)) {
        _float?.repeat(reverse: true);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    _settleForMotion(NexaColors.reducedMotion(context));
    // The design's breathe keyframe: scale 1 → 1.045, opacity .93 → 1.
    final breathing = CurvedAnimation(parent: _breathe, curve: Curves.easeInOut);

    Widget mark = AnimatedBuilder(
      animation: breathing,
      builder: (context, child) {
        final t = breathing.value;
        return Opacity(
          opacity: (0.93 + 0.07 * t) * widget.opacity,
          child: Transform.scale(scale: 1.0 + 0.045 * t, child: child),
        );
      },
      child: _GlowingMark(
        asset: widget.material.asset,
        size: widget.size,
        // A bloom that reads as light on near-black reads as grime on
        // off-white, so the palette says how much of it to actually draw.
        glow: widget.glow * NexaColors.of(context).glowScale,
        glowOpacity: widget.glowOpacity,
      ),
    );

    final float = _float;
    if (float != null) {
      final drifting = CurvedAnimation(parent: float, curve: Curves.easeInOut);
      mark = AnimatedBuilder(
        animation: drifting,
        builder: (context, child) {
          // translateY(-6px → 6px) with a degree of counter-rotation.
          final t = drifting.value * 2 - 1;
          return Transform.translate(
            offset: Offset(0, 6 * t),
            child: Transform.rotate(angle: t * math.pi / 180, child: child),
          );
        },
        child: mark,
      );
    }

    return mark;
  }
}

/// The mark plus its bloom. Split out so the breathing rebuild does not have
/// to re-run the blur every frame — it rides as the `child` of the builder.
class _GlowingMark extends StatelessWidget {
  const _GlowingMark({
    required this.asset,
    required this.size,
    required this.glow,
    required this.glowOpacity,
  });

  final String asset;
  final double size;
  final double glow;
  final double glowOpacity;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final image = Image.asset(asset, width: size, fit: BoxFit.contain);

    if (glow <= 0) return image;

    // A CSS blur radius of r is a Gaussian sigma of r/2.
    final sigma = glow / 2;

    return Stack(
      alignment: Alignment.center,
      children: [
        ImageFiltered(
          imageFilter: ui.ImageFilter.blur(sigmaX: sigma, sigmaY: sigma),
          child: ColorFiltered(
            colorFilter: ColorFilter.mode(
              c.emerald.withValues(alpha: glowOpacity),
              BlendMode.srcATop,
            ),
            child: image,
          ),
        ),
        image,
      ],
    );
  }
}

/// The soft emerald bloom that sits behind the mark and pulses on its own,
/// slower cycle. It is what makes a near-black screen feel lit rather than
/// empty.
class NexaHalo extends StatefulWidget {
  const NexaHalo({
    super.key,
    this.size = 520,
    this.opacity = 0.17,
    this.period = NexaMotion.halo,
  });

  final double size;
  final double opacity;
  final Duration period;

  @override
  State<NexaHalo> createState() => _NexaHaloState();
}

class _NexaHaloState extends State<NexaHalo>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.period,
  )..repeat(reverse: true);

  @override
  void didUpdateWidget(NexaHalo old) {
    super.didUpdateWidget(old);
    if (old.period != widget.period) {
      _c.duration = widget.period;
      _c.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final pulse = CurvedAnimation(parent: _c, curve: Curves.easeInOut);
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: pulse,
        builder: (context, child) {
          final t = pulse.value;
          // opacity .3 → .6, scale 1 → 1.09
          return Opacity(
            opacity: 0.3 + 0.3 * t,
            child: Transform.scale(scale: 1.0 + 0.09 * t, child: child),
          );
        },
        child: SizedBox(
          width: widget.size,
          height: widget.size,
          child: DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  c.emerald.withValues(alpha: widget.opacity),
                  c.emerald.withValues(alpha: 0),
                ],
                stops: const [0.0, 0.62],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The ring that leaves the mark while Nexa is listening — one expanding
/// circle, faded out as it goes.
class NexaListeningRing extends StatefulWidget {
  const NexaListeningRing({super.key, this.size = 250});

  final double size;

  @override
  State<NexaListeningRing> createState() => _NexaListeningRingState();
}

class _NexaListeningRingState extends State<NexaListeningRing>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: NexaMotion.wave,
  )..repeat();

  /// Reduced motion parks the loop at rest; the shape and the light stay.
  void _settleForMotion(bool reduced) {
    if (reduced && _c.isAnimating) {
      _c.stop();
      _c.value = 0;
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
    final c = NexaColors.of(context);
    _settleForMotion(NexaColors.reducedMotion(context));
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, child) {
          final t = Curves.easeOut.transform(_c.value);
          // scale .6 → 2.3, opacity .5 → 0
          return Opacity(
            opacity: 0.5 * (1 - t),
            child: Transform.scale(scale: 0.6 + 1.7 * t, child: child),
          );
        },
        child: Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: c.emerald.withValues(alpha: 0.24),
              width: 1,
            ),
          ),
        ),
      ),
    );
  }
}
