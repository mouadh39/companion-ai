import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';

import '../../app_state.dart';
import '../../data/repositories/pairing_qr_encoder.dart';
import '../../data/repositories/tqrcg_service.dart';
import '../../theme/nexa_theme.dart';
import '../../widgets/nexa_controls.dart';
import '../../widgets/nexa_mark.dart';

/// The TQRCG code.
///
/// TQRCG is Nexa's pairing code system: this phone generates the code and the
/// headset reads it off the screen. The payload carries the account's identity
/// and a single-use pairing secret, so the user is never asked to type
/// anything and nothing readable is ever spelled out.
///
/// Issuing the real code is the service's job; this screen drives every state
/// off [TqrcgService], so that work replaces the service and leaves this file
/// alone.
class TqrcgCodeScreen extends StatefulWidget {
  const TqrcgCodeScreen({super.key});

  @override
  State<TqrcgCodeScreen> createState() => _TqrcgCodeScreenState();
}

class _TqrcgCodeScreenState extends State<TqrcgCodeScreen> {
  StreamSubscription<PairingProgress>? _sub;

  /// Held directly, because dispose() runs after this element is deactivated
  /// and an inherited-widget lookup there is unsafe.
  TqrcgService? _service;
  String? _deviceName;
  Timer? _handoff;
  PairingProgress _progress = const PairingProgress(
    phase: PairingPhase.issuing,
    message: 'Preparing secure pairing…',
  );

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  void _start() {
    final state = NexaScope.of(context);
    final device = state.deviceId == null
        ? null
        : state.deviceRepository.byId(state.deviceId!);

    setState(() => _deviceName = device?.name);

    _sub?.cancel();
    _service = state.tqrcgService;
    _sub = _service!
        .issue(
          deviceId: state.deviceId ?? '',
          deviceName: device?.name,
          pairingContext: state.pairingContext,
        )
        .listen((p) {
          if (!mounted) return;
          setState(() => _progress = p);
          state.setPairingPhase(p.phase);
          if (p.phase == PairingPhase.paired) {
            _handoff = Timer(const Duration(milliseconds: 700), () {
              if (mounted) state.completePairing();
            });
          }
        });
  }

  @override
  void dispose() {
    _handoff?.cancel();
    _sub?.cancel();
    // Withdraw the code if the user leaves before it settles.
    unawaited(_service?.cancel() ?? Future<void>.value());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final state = NexaScope.of(context);
    final phase = _progress.phase;
    final read =
        phase == PairingPhase.headsetReading || phase == PairingPhase.paired;
    final deviceName = _progress.payload?.deviceName ?? _deviceName;

    return DecoratedBox(
      decoration: BoxDecoration(color: c.void_),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(30, 22, 30, 38),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  NexaBackButton(
                    onTap: () => state.back(fallback: NexaScreen.pairing),
                    size: 20,
                  ),
                  const Spacer(),
                  Text(
                    'TQRCG',
                    style: NexaType.label(
                      size: 11,
                      tracking: 0.24,
                      color: c.emerald,
                      weight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              if (deviceName != null) ...[
                Text(
                  deviceName.toUpperCase(),
                  style: NexaType.label(
                    size: 10,
                    tracking: 0.24,
                    color: c.emerald,
                  ),
                ),
                const SizedBox(height: 10),
              ],
              Text(
                'Complete pairing',
                style: NexaType.display(size: 27).copyWith(height: 1.2),
              ),
              const SizedBox(height: 10),
              Text(
                // The camera in this step belongs to the headset. Nothing on
                // this screen may suggest the phone is doing the looking.
                'Look at this code with your headset.',
                style: NexaType.body(size: 14.5, color: c.ink45)
                    .copyWith(height: 1.55),
              ),

              Expanded(
                child: Center(
                  child: _CodePanel(
                    phase: phase,
                    token: _progress.payload?.token,
                  ),
                ),
              ),

              _PhaseLine(progress: _progress, settled: read),
              const SizedBox(height: 22),
              Text(
                'Single-use. It expires on its own, and you never type it.',
                textAlign: TextAlign.center,
                style: NexaType.ui(size: 12, color: c.ink30),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The code itself, on a near-white panel.
///
/// This is the one surface in the app that is not near-black, and deliberately
/// so: a headset camera has to read it. The panel is the same near-white the
/// primary action uses, so it still belongs to the system.
class _CodePanel extends StatelessWidget {
  const _CodePanel({required this.phase, this.token});

  final PairingPhase phase;
  final String? token;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final showing = phase == PairingPhase.showing && token != null;
    final done = phase == PairingPhase.paired;
    final read = phase == PairingPhase.headsetReading || done;

    // Encoded fresh on every build rather than cached on the widget or in
    // state: a pairing code is shown for at most the backend's own 2-minute
    // session lifetime, so there is no meaningful cost to re-deriving a QR
    // symbol from it instead of holding onto one — see the module doc on
    // why this app does not cache a pairing code any longer than it must.
    final qrCode = token == null ? null : const PairingQrEncoder().encode(token!);

    return SizedBox(
      width: 252,
      height: 252,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // The pool of light the code sits in — the code is what the headset
          // is looking for, so the screen leans towards it.
          IgnorePointer(
            child: AnimatedOpacity(
              duration: NexaMotion.slow,
              opacity: read ? 0.5 : 0.28,
              child: Container(
                width: 300,
                height: 300,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: c.emerald.withValues(alpha: 0.22),
                      blurRadius: 90,
                      spreadRadius: 10,
                    ),
                  ],
                ),
              ),
            ),
          ),

          AnimatedContainer(
            duration: NexaMotion.slow,
            curve: NexaMotion.curve,
            width: 252,
            height: 252,
            decoration: BoxDecoration(
              // Once the headset has read it the code has done its work, so
              // the panel steps back and lets the mark carry the moment.
              color: read ? c.card : _codePaper,
              borderRadius: NexaRadius.sheetAll,
              border: Border.all(
                color: read
                    ? c.emeraldBorder
                    : const Color(0x00000000),
                width: 1,
              ),
            ),
            // The code leaves faster than the panel darkens, so it is never
            // caught as dark modules on a dark ground.
            child: AnimatedOpacity(
              duration: NexaMotion.fast,
              curve: NexaMotion.enter,
              opacity: showing ? 1 : 0,
              child: qrCode == null
                  ? const SizedBox.shrink()
                  : CustomPaint(
                      painter: TqrcgCodePainter(qrCode: qrCode),
                      size: const Size.square(252),
                    ),
            ),
          ),

          // While the code is being made, and again once it has been read,
          // the mark stands in for it.
          if (phase == PairingPhase.issuing)
            const NexaMark(
              size: 84,
              glow: 40,
              glowOpacity: 0.45,
              breathe: Duration(milliseconds: 1700),
            ),
          if (phase == PairingPhase.headsetReading)
            const NexaMark(
              size: 96,
              glow: 48,
              glowOpacity: 0.5,
              breathe: Duration(milliseconds: 1700),
            ),
          if (done) const NexaMark(size: 108, glow: 62, glowOpacity: 0.72),
        ],
      ),
    );
  }
}

/// The code's own two colours. These do not follow the app's appearance:
/// a camera is reading this panel, so it is dark ink on paper in both modes.
const _codePaper = Color(0xFFEDF2EE);
const _codeInk = Color(0xFF07090C);
const _codeGlyph = Color(0xFF4ADE9B);

/// Draws a real, standards-compliant QR symbol — [qrCode]'s own module
/// matrix, from `PairingQrEncoder` — with the mark's clear zone left open
/// in the middle.
///
/// This used to render a placeholder pattern derived deterministically
/// from the raw token; every module painted here now comes from a genuine
/// QR encoding of the backend's own pairing code (see
/// `PairingQrEncoder`/`PairingQrCode`) and is meant to be pointed at a
/// camera. The finder-pattern styling and the mark-in-the-center
/// composition are unchanged from before — only where the module data
/// itself comes from has changed.
class TqrcgCodePainter extends CustomPainter {
  const TqrcgCodePainter({required this.qrCode});

  final PairingQrCode qrCode;

  /// Modules of white margin on every side. 4, not the 3 the placeholder
  /// pattern used — the QR specification's own recommended minimum quiet
  /// zone, which a symbol meant to actually be scanned should not shave
  /// below.
  static const _quiet = 4;

  /// Half-width, in modules, of the clear zone reserved for the mark.
  ///
  /// This exact formula — and no larger — is what
  /// `test/pairing_qr_round_trip_test.dart` renders to real pixels and
  /// decodes with an independent QR implementation (`zxing2`) with this
  /// many center modules forced light, at the `QrErrorCorrectLevel.H` this
  /// encoder always uses. A real camera and a real headset remain
  /// unverified — see the report — but this proportion is not a guess.
  static int _clearHalfWidth(int moduleCount) =>
      (moduleCount * 0.09).round().clamp(2, 6);

  @override
  void paint(Canvas canvas, Size size) {
    final modules = qrCode.moduleCount;
    final cell = size.width / (modules + _quiet * 2);
    final ink = Paint()..color = _codeInk;

    void module(int col, int row) {
      final r = Rect.fromLTWH(
        (col + _quiet) * cell,
        (row + _quiet) * cell,
        cell,
        cell,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(r.deflate(cell * 0.06), Radius.circular(cell * 0.3)),
        ink,
      );
    }

    // The three finders a reader locks onto. Drawn with this rounded
    // styling rather than the plain squares the real symbol's own finder
    // modules would otherwise paint as — a QR reader only needs the
    // 7x7/5x5/3x3 nested-square *ratio* to recognise one, which this
    // preserves exactly; the corner rounding is cosmetic.
    void finder(int col, int row) {
      final r = Rect.fromLTWH(
        (col + _quiet) * cell,
        (row + _quiet) * cell,
        cell * 7,
        cell * 7,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(r, Radius.circular(cell * 1.8)),
        ink,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(r.deflate(cell), Radius.circular(cell * 1.2)),
        Paint()..color = _codePaper,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(r.deflate(cell * 2), Radius.circular(cell * 0.8)),
        ink,
      );
    }

    final clear = _clearHalfWidth(modules);
    final centre = modules ~/ 2;

    for (var row = 0; row < modules; row++) {
      for (var col = 0; col < modules; col++) {
        final inFinder =
            (col < 7 && row < 7) ||
            (col >= modules - 7 && row < 7) ||
            (col < 7 && row >= modules - 7);
        final inClearZone =
            (col - centre).abs() <= clear && (row - centre).abs() <= clear;
        if (inFinder || inClearZone) continue;
        if (qrCode.isDark(row, col)) module(col, row);
      }
    }

    finder(0, 0);
    finder(modules - 7, 0);
    finder(0, modules - 7);

    // The mark sits in the clear zone, the way a logo does in a code.
    final markSide = cell * (clear * 2 + 1);
    final markRect = Rect.fromCenter(
      center: Offset(size.width / 2, size.height / 2),
      width: markSide,
      height: markSide,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(markRect, Radius.circular(cell * 1.6)),
      Paint()..color = _codeInk,
    );
    final glyph = Paint()
      ..color = _codeGlyph
      ..style = PaintingStyle.stroke
      ..strokeWidth = cell * 0.62
      ..strokeJoin = StrokeJoin.round;
    final g = markRect.deflate(cell * 1.7);
    canvas.drawPath(_markPath(g.center, g.width / 2), glyph);
  }

  /// The mark's silhouette: a rounded triangle, drawn as a quadratic spline
  /// through the midpoints of an equilateral triangle so the corners round
  /// themselves.
  static Path _markPath(Offset centre, double radius) {
    final points = <Offset>[
      for (var i = 0; i < 3; i++)
        Offset(
          centre.dx + radius * math.cos(-math.pi / 2 + i * 2 * math.pi / 3),
          centre.dy + radius * math.sin(-math.pi / 2 + i * 2 * math.pi / 3),
        ),
    ];
    Offset mid(int a, int b) => (points[a] + points[b]) / 2;

    final path = Path()..moveTo(mid(0, 1).dx, mid(0, 1).dy);
    for (var i = 1; i <= 3; i++) {
      final vertex = points[i % 3];
      final next = mid(i % 3, (i + 1) % 3);
      path.quadraticBezierTo(vertex.dx, vertex.dy, next.dx, next.dy);
    }
    return path..close();
  }

  @override
  bool shouldRepaint(TqrcgCodePainter old) => old.qrCode.payload != qrCode.payload;
}

/// What is happening, in one line, with a dot that reflects the phase.
class _PhaseLine extends StatelessWidget {
  const _PhaseLine({required this.progress, required this.settled});

  final PairingProgress progress;
  final bool settled;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    final failed = progress.phase == PairingPhase.failed;

    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        NexaStatusDotSmall(
          color: failed
              ? c.danger
              : settled
              ? c.emerald
              : c.ink42,
          pulse: !settled && !failed,
        ),
        const SizedBox(width: 10),
        Flexible(
          child: Text(
            progress.message,
            textAlign: TextAlign.center,
            style: NexaType.ui(
              size: 14,
              color: failed ? c.danger : c.ink72,
            ),
          ),
        ),
      ],
    );
  }
}

/// A small dot that breathes while the code is still waiting to be read.
class NexaStatusDotSmall extends StatefulWidget {
  const NexaStatusDotSmall({
    super.key,
    required this.color,
    this.pulse = false,
  });

  final Color color;
  final bool pulse;

  @override
  State<NexaStatusDotSmall> createState() => _NexaStatusDotSmallState();
}

class _NexaStatusDotSmallState extends State<NexaStatusDotSmall>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dot = Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(
        color: widget.color,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: widget.color.withValues(alpha: 0.7),
            blurRadius: 10,
          ),
        ],
      ),
    );

    if (!widget.pulse) return dot;

    return FadeTransition(
      opacity: Tween<double>(begin: 0.35, end: 1.0).animate(
        CurvedAnimation(parent: _c, curve: Curves.easeInOut),
      ),
      child: dot,
    );
  }
}
