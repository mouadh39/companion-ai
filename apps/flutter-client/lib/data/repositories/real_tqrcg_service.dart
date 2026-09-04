import 'dart:async';
import 'dart:io';

import '../models/pairing_api.dart';
import '../models/pairing_context_message.dart';
import 'lan_discovery_socket.dart';
import 'pairing_context_codec.dart';
import 'pairing_session_repository.dart';
import 'tqrcg_service.dart';

/// The real [TqrcgService]: creates a genuine pairing session, displays its
/// genuine code, best-effort hands the headset its `pairingSessionId` over
/// LAN, and — this is the whole point of this class existing — never
/// reports [PairingPhase.paired] on its own say-so. Redemption happens on a
/// headset this phone never talks to directly; the backend's own
/// authoritative status (`PairingSessionRepository.getStatus`, polled) is
/// the only thing that can ever move this stream to [PairingPhase.paired]
/// or to a redemption-caused [PairingPhase.failed].
///
/// ## What "QR scanned" is not
///
/// There is no code path anywhere in this class that treats a headset
/// reading the code, or receiving a pairing-context reply, as pairing
/// having succeeded. Both of those are this phone acting — sending a code
/// display, sending a LAN datagram — and neither is evidence of what the
/// headset then did with them. Only a polled `redeemed` status, which the
/// backend only ever reports after verifying a real cryptographic
/// signature (`PairingSessionStore.redeem`), moves this stream to
/// [PairingPhase.paired].
///
/// ## Sending pairing context is best-effort, deliberately
///
/// If [HeadsetPairingContext.headsetEndpoint] is `null` (the discovering
/// transport could not report one) or the send itself throws, this class
/// still creates the session and shows the code — the poll loop below is
/// the actual source of truth for whether the attempt ever completes, and a
/// user is not blocked from at least trying because one convenience send
/// failed.
class RealTqrcgService implements TqrcgService {
  RealTqrcgService({
    required PairingSessionRepository pairingSession,
    required LanDiscoverySocket lanSocket,
    this.pollInterval = const Duration(seconds: 2),
  }) : _pairingSession = pairingSession,
       _lanSocket = lanSocket;

  final PairingSessionRepository _pairingSession;
  final LanDiscoverySocket _lanSocket;

  /// How often [getStatus] is polled while a code is on screen. A real
  /// deployment might want this configurable per environment; exposed as a
  /// constructor field rather than hardcoded so a test does not have to
  /// wait on production timing.
  final Duration pollInterval;

  StreamController<PairingProgress>? _controller;

  @override
  Stream<PairingProgress> issue({
    required String deviceId,
    String? deviceName,
    HeadsetPairingContext? pairingContext,
  }) {
    _teardown();
    final controller = StreamController<PairingProgress>();
    _controller = controller;

    unawaited(_run(controller, deviceId, deviceName, pairingContext));

    return controller.stream;
  }

  Future<void> _run(
    StreamController<PairingProgress> controller,
    String deviceId,
    String? deviceName,
    HeadsetPairingContext? pairingContext,
  ) async {
    final name = deviceName ?? 'your headset';

    if (pairingContext == null) {
      _emit(
        controller,
        PairingProgress(
          phase: PairingPhase.failed,
          message: "Couldn't find $name to pair with.",
          failure: 'no_pairing_context',
        ),
      );
      controller.close();
      return;
    }

    _emit(
      controller,
      const PairingProgress(
        phase: PairingPhase.issuing,
        message: 'Preparing secure pairing…',
      ),
    );

    final PairingSession session;
    try {
      session = await _pairingSession.createPairingSession(
        enrolmentHandle: pairingContext.enrolmentHandle,
      );
    } catch (_) {
      _emit(
        controller,
        PairingProgress(
          phase: PairingPhase.failed,
          message: 'Could not start pairing. Try again.',
          failure: 'session_create_failed',
        ),
      );
      controller.close();
      return;
    }

    if (controller.isClosed) return; // cancel() raced the session creation

    final payload = TqrcgPayload(
      token: session.code,
      deviceId: deviceId,
      deviceName: name,
    );
    _emit(
      controller,
      PairingProgress(
        phase: PairingPhase.showing,
        message: 'Look at this code with $name.',
        payload: payload,
      ),
    );

    _sendPairingContextBestEffort(pairingContext, session);

    await _pollUntilSettled(controller, session, payload);
  }

  /// Best-effort — see the class doc. Never throws past this method, and
  /// never emits a [PairingProgress] of its own: a failed send is not a
  /// failed pairing attempt, only a worse one.
  void _sendPairingContextBestEffort(
    HeadsetPairingContext pairingContext,
    PairingSession session,
  ) {
    final endpoint = pairingContext.headsetEndpoint;
    if (endpoint == null) return;

    final address = InternetAddress.tryParse(endpoint.host);
    if (address == null) return; // malformed/invalid address — nothing safe to send to

    try {
      final raw = PairingContextCodec.encode(
        PairingContextMessage(pairingSessionId: session.pairingSessionId),
      );
      _lanSocket.send(raw, address, endpoint.port);
    } catch (_) {
      // Swallowed deliberately — see the class doc.
    }
  }

  Future<void> _pollUntilSettled(
    StreamController<PairingProgress> controller,
    PairingSession session,
    TqrcgPayload payload,
  ) async {
    while (!controller.isClosed) {
      if (session.isExpired()) {
        _emit(
          controller,
          PairingProgress(
            phase: PairingPhase.failed,
            message: 'That pairing code expired.',
            failure: 'expired',
            payload: payload,
          ),
        );
        controller.close();
        return;
      }

      await Future<void>.delayed(pollInterval);
      if (controller.isClosed) return;

      PairingSessionStatus status;
      try {
        status = await _pairingSession.getStatus(session.pairingSessionId);
      } catch (_) {
        // A transient network hiccup on one poll must not fail the whole
        // attempt — the next tick tries again, up to the session's own
        // expiry, checked at the top of this loop.
        continue;
      }

      if (controller.isClosed) return;

      switch (status.status) {
        case PairingSessionStatusValue.redeemed:
          // The one and only place this stream ever reaches `paired` — and
          // it is reached only because the backend, not this phone, said
          // so. See the class doc.
          _emit(
            controller,
            PairingProgress(
              phase: PairingPhase.paired,
              message: 'Paired.',
              payload: payload,
            ),
          );
          controller.close();
          return;
        case PairingSessionStatusValue.expired:
        case PairingSessionStatusValue.cancelled:
          _emit(
            controller,
            PairingProgress(
              phase: PairingPhase.failed,
              message: 'That pairing code expired.',
              failure: status.status.name,
              payload: payload,
            ),
          );
          controller.close();
          return;
        case PairingSessionStatusValue.pending:
          continue;
      }
    }
  }

  void _emit(StreamController<PairingProgress> controller, PairingProgress progress) {
    if (!controller.isClosed) controller.add(progress);
  }

  @override
  Future<void> cancel() async => _teardown();

  void _teardown() {
    final c = _controller;
    _controller = null;
    if (c != null && !c.isClosed) c.close();
  }
}
