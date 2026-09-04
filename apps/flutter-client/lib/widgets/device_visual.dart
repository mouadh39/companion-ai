import 'package:flutter/widgets.dart';

import '../data/models/device.dart';
import '../theme/nexa_theme.dart';

/// The colour a status reads in.
Color statusColor(NexaPalette c, DeviceStatus s) => switch (s) {
  DeviceStatus.thisDevice || DeviceStatus.connected => c.emeraldBright,
  DeviceStatus.disconnected => c.ink45,
  DeviceStatus.available => c.ink50,
  DeviceStatus.comingSoon => c.emeraldHighlight.withValues(alpha: 0.62),
};

/// The dot beside it.
Color statusDotColor(NexaPalette c, DeviceStatus s) => switch (s) {
  DeviceStatus.thisDevice || DeviceStatus.connected => c.emerald,
  DeviceStatus.disconnected => c.danger.withValues(alpha: 0.5),
  _ => c.ink30,
};

/// A device photographed on a Nexa surface: the product shot floating over a
/// pool of emerald light, drifting so it never sits dead on the page.
class DeviceVisual extends StatefulWidget {
  const DeviceVisual({
    super.key,
    required this.device,
    this.glow = 0.15,
    this.padding = 14,
    this.driftSeconds = 15,
  });

  final NexaDevice device;

  /// How lit the pool beneath it is.
  final double glow;

  final double padding;
  final int driftSeconds;

  @override
  State<DeviceVisual> createState() => _DeviceVisualState();
}

class _DeviceVisualState extends State<DeviceVisual>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: Duration(seconds: widget.driftSeconds),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }


  /// Reduced motion parks the loop at rest; the shape and the light stay.
  void _settleForMotion(bool reduced) {
    if (reduced && _c.isAnimating) {
      _c.stop();
      _c.value = 0;
    } else if (!reduced && !_c.isAnimating) {
      _c.repeat(reverse: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    _settleForMotion(NexaColors.reducedMotion(context));
    final dimmed = widget.device.status == DeviceStatus.comingSoon;
    final drift = CurvedAnimation(parent: _c, curve: Curves.easeInOut);

    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(0, 1.1),
          radius: 0.9,
          colors: [
            (dimmed ? c.emeraldHighlight : c.emerald)
                .withValues(alpha: dimmed ? 0.06 : widget.glow),
            const Color(0x00000000),
          ],
          stops: const [0.0, 0.72],
        ),
      ),
      child: Padding(
        padding: EdgeInsets.all(widget.padding),
        child: AnimatedBuilder(
          animation: drift,
          builder: (context, child) => Transform.translate(
            offset: Offset(0, 5 * (drift.value * 2 - 1)),
            child: child,
          ),
          child: Opacity(
            opacity: dimmed ? 0.72 : 1.0,
            child: Image.asset(
              widget.device.image,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.medium,
            ),
          ),
        ),
      ),
    );
  }
}

/// The status line: a dot and a word.
class DeviceStatusLine extends StatelessWidget {
  const DeviceStatusLine({
    super.key,
    required this.status,
    this.size = 11,
  });

  final DeviceStatus status;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = NexaColors.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(
            color: statusDotColor(c, status),
            shape: BoxShape.circle,
            boxShadow: status.isPaired && status != DeviceStatus.disconnected
                ? [
                    BoxShadow(
                      color: c.emerald.withValues(alpha: 0.85),
                      blurRadius: 9,
                    ),
                  ]
                : null,
          ),
        ),
        const SizedBox(width: 8),
        Text(
          status.label.toUpperCase(),
          style: NexaType.label(
            size: size,
            tracking: 0.14,
            color: statusColor(c, status),
            weight: FontWeight.w400,
          ),
        ),
      ],
    );
  }
}
