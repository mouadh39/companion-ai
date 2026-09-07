import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

import '../app_state.dart';
import '../theme/nexa_theme.dart';

/// The launch experience — not a splash screen.
///
/// The Nexa mark arrives as a physical object: it fades and rises into place
/// on a no-bounce cinematic curve, drifts in a slow orientation, takes one
/// emerald light pass **across the object itself** (masked to the mark's own
/// silhouette, not a glow behind it), breathes, holds, then scales down and
/// hands off — to sign in for a visitor, or straight to the authenticated
/// destination for a recognised account.
///
/// Three timings, matching the authoritative DesignSync spec:
///   * first launch — ~2.8s, the full sequence with the light pass;
///   * a returning, recognised account — ~0.9s, no light pass;
///   * reduced motion — ~0.8s, a plain cross-fade, every loop parked.
///
/// The routing decision is real ([NexaAppState.completeEntrance]); this
/// screen only owns the time before it.
class EntranceScreen extends StatefulWidget {
  const EntranceScreen({super.key});

  @override
  State<EntranceScreen> createState() => _EntranceScreenState();
}

enum _Variant { firstLaunch, returning, reduced }

class _EntranceScreenState extends State<EntranceScreen>
    with TickerProviderStateMixin {
  static const _markAsset = 'assets/marks/mark-emerald.png';
  static const _ease = Cubic(0.22, 0.61, 0.16, 1.0);

  /// Drives the arrive → hold → exit envelope. Its total is the whole
  /// entrance; when it finishes, the hand-off runs.
  late final AnimationController _timeline;

  /// The ambient loops — breathing, the slow orientation drift, the aura
  /// pulse. One controller, parked entirely under reduced motion.
  late final AnimationController _ambient;

  /// The single light pass. Runs twice on first launch, not at all otherwise.
  AnimationController? _sweep;
  int _sweepsLeft = 0;
  Timer? _sweepStart;

  _Variant _variant = _Variant.firstLaunch;
  bool _resolved = false;

  /// The decoded mark, for masking the light pass to its silhouette. Null
  /// until it loads (and if it never does, the pass is simply skipped).
  ui.Image? _markImage;
  ImageStream? _markStream;
  late final ImageStreamListener _markListener;

  // Envelope timings per variant, in milliseconds. arrive + alive + hold +
  // out; the light pass starts 60ms into the alive window.
  int get _arriveMs => switch (_variant) {
        _Variant.firstLaunch => 1100,
        _Variant.returning => 480,
        _Variant.reduced => 380,
      };
  int get _aliveMs => switch (_variant) {
        _Variant.firstLaunch => 900,
        _Variant.returning => 120,
        _Variant.reduced => 0,
      };
  int get _holdMs => switch (_variant) {
        _Variant.firstLaunch => 300,
        _Variant.returning => 150,
        _Variant.reduced => 160,
      };
  int get _outMs => switch (_variant) {
        _Variant.firstLaunch => 480,
        _Variant.returning => 240,
        _Variant.reduced => 260,
      };
  int get _totalMs => _arriveMs + _aliveMs + _holdMs + _outMs;

  @override
  void initState() {
    super.initState();
    _timeline = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _handOff();
      });
    _ambient = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 5200),
    );
    _markListener = ImageStreamListener((info, _) {
      if (!mounted) {
        info.image.dispose();
        return;
      }
      // Our own copy to hold and dispose — the one in `info` belongs to the
      // image cache.
      setState(() => _markImage = info.image.clone());
      info.image.dispose();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _resolveMarkImage();
    if (_resolved) return;
    _resolved = true;
    unawaited(_start(
      reduced: NexaColors.reducedMotion(context),
      state: NexaScope.of(context),
    ));
  }

  Future<void> _start({
    required bool reduced,
    required NexaAppState state,
  }) async {
    // Give the session restore a brief moment to settle — a recognised
    // account should get the short entrance, not the first-launch one — but
    // never hold the launch open on a slow or unavailable secure store.
    if (!reduced) {
      await state.bootComplete
          .timeout(const Duration(milliseconds: 250), onTimeout: () {});
    }
    if (!mounted) return;

    setState(() {
      _variant = reduced
          ? _Variant.reduced
          : state.authSession.isSignedIn
              ? _Variant.returning
              : _Variant.firstLaunch;
    });

    _timeline
      ..duration = Duration(milliseconds: _totalMs)
      ..forward();

    if (_variant != _Variant.reduced) {
      _ambient.repeat(reverse: true);
    }

    if (_variant == _Variant.firstLaunch) {
      _sweep = AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 1500),
      )..addStatusListener((status) {
          if (status != AnimationStatus.completed) return;
          if (--_sweepsLeft > 0) {
            _sweep!
              ..reset()
              ..forward();
          }
        });
      _sweepsLeft = 2;
      _sweepStart = Timer(
        Duration(milliseconds: _arriveMs + 60),
        () => _sweep?.forward(),
      );
    }
  }

  void _resolveMarkImage() {
    final stream =
        const AssetImage(_markAsset).resolve(createLocalImageConfiguration(context));
    if (stream.key == _markStream?.key) return;
    _markStream?.removeListener(_markListener);
    _markStream = stream..addListener(_markListener);
  }

  Future<void> _handOff() async {
    if (!mounted) return;
    await NexaScope.of(context).completeEntrance();
  }

  @override
  void dispose() {
    _sweepStart?.cancel();
    _markStream?.removeListener(_markListener);
    _markImage?.dispose();
    _sweep?.dispose();
    _ambient.dispose();
    _timeline.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final glowRgb = c.isDark
        ? const Color(0xFF4ADE9B)
        : const Color(0xFF12805A);

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, -0.05),
          radius: 1.1,
          colors: [c.groundTop, c.void_],
          stops: const [0.0, 0.78],
        ),
      ),
      child: Center(
        child: AnimatedBuilder(
          animation: Listenable.merge([_timeline, _ambient, _sweep]),
          builder: (context, _) {
            final env = _envelope();
            return Opacity(
              opacity: env.opacity,
              child: Transform.translate(
                offset: Offset(0, env.rise),
                child: Transform.scale(
                  scale: env.scale,
                  child: SizedBox(
                    width: 220,
                    height: 220,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        _aura(glowRgb),
                        _orientedMark(glowRgb),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  ({double opacity, double rise, double scale}) _envelope() {
    final t = _timeline.value * _totalMs;
    final arrive = _arriveMs.toDouble();
    final exitAt = (_totalMs - _outMs).toDouble();

    // Arrive.
    if (t <= arrive) {
      final p = _ease.transform((t / arrive).clamp(0.0, 1.0));
      final from = switch (_variant) {
        _Variant.firstLaunch => (rise: 16.0, scale: 0.88, plain: false),
        _Variant.returning => (rise: 8.0, scale: 0.94, plain: false),
        _Variant.reduced => (rise: 0.0, scale: 1.0, plain: true),
      };
      return (
        opacity: p,
        rise: from.plain ? 0.0 : from.rise * (1 - p),
        scale: from.plain ? 1.0 : from.scale + (1 - from.scale) * p,
      );
    }
    // Exit.
    if (t >= exitAt) {
      final p = _ease.transform(((t - exitAt) / _outMs).clamp(0.0, 1.0));
      return (opacity: 1 - p, rise: 0.0, scale: 1.0 - 0.035 * p);
    }
    // Hold / alive.
    return (opacity: 1.0, rise: 0.0, scale: 1.0);
  }

  Widget _aura(Color glow) {
    final reduced = _variant == _Variant.reduced;
    // opacity .3 → .85, scale .94 → 1.06 on the ambient cycle; static at .55
    // under reduced motion.
    final t = reduced ? 0.5 : Curves.easeInOut.transform(_ambient.value);
    return IgnorePointer(
      child: Opacity(
        opacity: 0.3 + 0.55 * t,
        child: Transform.scale(
          scale: 0.94 + 0.12 * t,
          child: Container(
            width: 300,
            height: 300,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  glow.withValues(alpha: _markImageDark ? 0.20 : 0.13),
                  glow.withValues(alpha: 0),
                ],
                stops: const [0.0, 0.62],
              ),
            ),
          ),
        ),
      ),
    );
  }

  bool get _markImageDark => NexaColors.of(context).isDark;

  Widget _orientedMark(Color glow) {
    final reduced = _variant == _Variant.reduced;
    // nx-orient: rotate ±2.4°, rotateY ±7° on the ambient cycle.
    final drift = reduced ? 0.0 : (_ambient.value * 2 - 1);
    final matrix = Matrix4.identity()
      ..setEntry(3, 2, 0.001)
      ..rotateY(drift * 7 * 3.1415926 / 180)
      ..rotateZ(drift * 2.4 * 3.1415926 / 180);

    final markBox = 168.0;
    final dark = _markImageDark;

    // nx-breathe: scale 1 → 1.028, -6px on the ambient cycle.
    final breatheT = reduced ? 0.0 : Curves.easeInOut.transform(_ambient.value);

    Widget mark = Image.asset(
      _markAsset,
      width: markBox,
      height: markBox,
      fit: BoxFit.contain,
    );

    // The bloom — a blurred, tinted copy of the mark's own silhouette, the
    // way the design's masked drop-shadow reads.
    mark = Stack(
      alignment: Alignment.center,
      children: [
        ImageFiltered(
          imageFilter: ui.ImageFilter.blur(
            sigmaX: (dark ? 32 : 20).toDouble(),
            sigmaY: (dark ? 32 : 20).toDouble(),
          ),
          child: ColorFiltered(
            colorFilter: ColorFilter.mode(
              glow.withValues(alpha: dark ? 0.42 : 0.22),
              BlendMode.srcATop,
            ),
            child: Image.asset(_markAsset,
                width: markBox, height: markBox, fit: BoxFit.contain),
          ),
        ),
        mark,
        if (_sweep != null && _markImage != null) _lightPass(markBox),
      ],
    );

    return Transform(
      alignment: Alignment.center,
      transform: matrix,
      child: Transform.translate(
        offset: Offset(0, -6 * breatheT),
        child: Transform.scale(scale: 1 + 0.028 * breatheT, child: mark),
      ),
    );
  }

  /// One diagonal band of light travelling left-to-right, clipped to the
  /// mark's own alpha via an [ImageShader] mask — so the light is *on* the
  /// object, not a rectangle passing behind it.
  Widget _lightPass(double box) {
    final s = _sweep!;
    if (!s.isAnimating && s.value == 0) return const SizedBox.shrink();
    final p = _ease.transform(s.value);
    final dark = _markImageDark;
    final img = _markImage!;
    final scale = box / img.width;

    return SizedBox(
      width: box,
      height: box,
      child: ShaderMask(
        blendMode: BlendMode.dstIn,
        shaderCallback: (rect) => ImageShader(
          img,
          TileMode.clamp,
          TileMode.clamp,
          Matrix4.diagonal3Values(scale, scale, 1).storage,
        ),
        child: ClipRect(
          child: Transform.translate(
            offset: Offset(box * (p * 2.4 - 1.2), 0),
            child: Transform.rotate(
              angle: 0.24,
              child: ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: 6, sigmaY: 6),
                child: Container(
                  width: box * 0.5,
                  height: box * 2,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        const Color(0x00FFFFFF),
                        (dark
                                ? const Color(0xFFBEFFE1)
                                : const Color(0xFFFFFFFF))
                            .withValues(alpha: dark ? 0.6 : 0.85),
                        const Color(0x00FFFFFF),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
