import 'dart:async';

import 'pairing.dart';

export 'pairing.dart'
    show
        PairingPhase,
        PairingProgress,
        TqrcgPayload,
        HeadsetPairingContext,
        HeadsetLanEndpoint;

/// Issues a TQRCG for the phone to display, and completes the pairing the
/// headset starts when it reads it.
///
/// TQRCG is Nexa's pairing code system. The direction is fixed: **this phone
/// generates the code and puts it on its own screen; the headset's camera
/// reads it off that screen.** The phone's camera is never involved, and the
/// user is never asked to type anything.
///
/// The real implementation will own the code's issuance, its encoding, and the
/// exchange with the pairing service. This interface is what the UI is written
/// against, so that work replaces the implementation and leaves the screens
/// alone.
abstract interface class TqrcgService {
  /// Issue a code for [deviceId] to display, and report progress until it
  /// settles on [PairingPhase.paired] or [PairingPhase.failed].
  ///
  /// Assumes the phone is already linked to the headset — see
  /// [DeviceLinkService]. [pairingContext] is what that link actually
  /// found: the enrolment handle a real implementation needs to create a
  /// pairing session at all, and the LAN address (when the transport could
  /// report one) needed to hand the headset its `pairingSessionId`. `null`
  /// means no real discovery happened (a scripted implementation ignores
  /// it; a real one has nothing to pair and must fail cleanly rather than
  /// invent a session).
  Stream<PairingProgress> issue({
    required String deviceId,
    String? deviceName,
    HeadsetPairingContext? pairingContext,
  });

  /// Withdraw a code that is still on screen.
  Future<void> cancel();
}

/// A scripted pairing for building and testing the UI.
///
/// It performs no cryptography and no network work, and the token it hands
/// back is a stand-in: it walks the same phases the real service will report,
/// on a fixed schedule, so every state in the code screen can be seen and
/// screenshotted. It must not be mistaken for a working pairing — nothing has
/// been verified, because there is nothing yet to verify it against.
class LocalTqrcgService implements TqrcgService {
  StreamController<PairingProgress>? _controller;
  final List<Timer> _timers = [];

  @override
  Stream<PairingProgress> issue({
    required String deviceId,
    String? deviceName,
    HeadsetPairingContext? pairingContext,
  }) {
    // Ignored deliberately — this is a scripted stand-in for UI building
    // and screenshots; see the class doc. A real implementation must not
    // do the same.
    _teardown();
    final controller = StreamController<PairingProgress>();
    _controller = controller;

    final name = deviceName ?? 'your headset';
    final payload = TqrcgPayload(
      // Opaque stand-in. The real token is issued by the pairing service.
      token: 'local-demo-$deviceId',
      deviceId: deviceId,
      deviceName: name,
    );

    void emit(Duration after, PairingProgress progress) {
      _timers.add(
        Timer(after, () {
          if (!controller.isClosed) controller.add(progress);
        }),
      );
    }

    emit(
      Duration.zero,
      const PairingProgress(
        phase: PairingPhase.issuing,
        message: 'Preparing secure pairing…',
      ),
    );
    emit(
      const Duration(milliseconds: 900),
      PairingProgress(
        phase: PairingPhase.showing,
        message: 'Look at this code with $name.',
        payload: payload,
      ),
    );
    emit(
      const Duration(milliseconds: 3400),
      PairingProgress(
        phase: PairingPhase.headsetReading,
        message: 'Your headset has read the code. Hold on…',
        payload: payload,
      ),
    );
    emit(
      const Duration(milliseconds: 5000),
      PairingProgress(
        phase: PairingPhase.paired,
        message: 'Paired.',
        payload: payload,
      ),
    );
    _timers.add(
      Timer(const Duration(milliseconds: 5200), () {
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
