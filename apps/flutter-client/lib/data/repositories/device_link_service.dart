import 'dart:async';

import 'pairing.dart';

/// Finds a headset nearby and opens a local connection to it.
///
/// This is the step before the code: the phone has to be talking to the
/// headset before it can show it anything worth reading. The real
/// implementation belongs to the platform's local transport — Bluetooth on
/// both platforms today — and will own scanning, permissions, the user's
/// choice among several nearby devices, and the connection itself.
///
/// The UI is written against this interface so that work replaces the
/// implementation and leaves the screens alone.
abstract interface class DeviceLinkService {
  /// Look for [deviceId] and connect to it, reporting progress until it
  /// settles on [PairingPhase.connected] or [PairingPhase.failed].
  Stream<PairingProgress> link({required String deviceId, String? deviceName});

  /// Drop an in-flight discovery or connection.
  Future<void> cancel();
}

/// A scripted link for building and testing the UI.
///
/// **There is no Bluetooth here.** It opens no radio, scans for nothing, and
/// connects to nothing: it walks the same phases a real transport will report,
/// on a fixed schedule, so the guide can be built and screenshotted. Nothing
/// it reports has been observed, because there is nothing yet observing.
class LocalDeviceLinkService implements DeviceLinkService {
  StreamController<PairingProgress>? _controller;
  final List<Timer> _timers = [];

  @override
  Stream<PairingProgress> link({
    required String deviceId,
    String? deviceName,
  }) {
    _teardown();
    final controller = StreamController<PairingProgress>();
    _controller = controller;

    final name = deviceName ?? 'your headset';

    void emit(Duration after, PairingProgress progress) {
      _timers.add(
        Timer(after, () {
          if (!controller.isClosed) controller.add(progress);
        }),
      );
    }

    emit(
      Duration.zero,
      PairingProgress(
        phase: PairingPhase.discovering,
        message: 'Looking for $name…',
      ),
    );
    emit(
      const Duration(milliseconds: 1600),
      PairingProgress(
        phase: PairingPhase.deviceFound,
        message: '$name found.',
      ),
    );
    emit(
      const Duration(milliseconds: 2400),
      const PairingProgress(
        phase: PairingPhase.connecting,
        message: 'Connecting…',
      ),
    );
    emit(
      const Duration(milliseconds: 3600),
      PairingProgress(
        phase: PairingPhase.connected,
        message: 'Connected to $name.',
      ),
    );
    _timers.add(
      Timer(const Duration(milliseconds: 3800), () {
        if (!controller.isClosed) controller.close();
      }),
    );

    return controller.stream;
  }

  @override
  Future<void> cancel() async => _teardown();

  void _teardown() {
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
    final c = _controller;
    _controller = null;
    if (c != null && !c.isClosed) c.close();
  }
}
