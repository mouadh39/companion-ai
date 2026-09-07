import 'package:flutter/widgets.dart';

import '../theme/nexa_theme.dart';

/// The wordmark. Light 300, wide tracking, uppercase — the one place the
/// brand speaks in its own voice rather than the interface's.
class NexaWordmark extends StatelessWidget {
  const NexaWordmark({
    super.key,
    this.size = 15,
    this.tracking = 0.52,
    this.color,
  });

  final double size;
  final double tracking;

  /// Defaults to the palette's ink.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      'NEXA',
      textAlign: TextAlign.center,
      style: NexaType.brand(size: size, tracking: tracking).copyWith(
        color: color ?? NexaColors.of(context).ink90,
      ),
    );
  }
}
