/// The one state model a pairing moves through, start to finish.
///
/// It spans two services because the work does: [DeviceLinkService] carries
/// the phone from [discovering] to [connected] over whatever local transport
/// the platform gives it, and [TqrcgService] carries it from [issuing] to
/// [paired] over the code the phone puts on its own screen.
///
/// The direction matters and is fixed: **the phone displays the TQRCG and the
/// headset's camera reads it.** The phone's camera is not involved at any
/// point, and no screen may say otherwise.
enum PairingPhase {
  /// Nothing has started.
  idle,

  /// Looking for the headset nearby.
  discovering,

  /// The headset has been found.
  deviceFound,

  /// Opening a local connection to it.
  connecting,

  /// Connected — the pairing session can begin.
  connected,

  /// The phone is preparing the pairing code.
  issuing,

  /// The code is on the phone's screen, waiting for the headset to read it.
  showing,

  /// The headset's camera has read the code off the screen.
  headsetReading,

  /// Done — the device is on the account.
  paired,

  /// The link dropped, or the code expired or was refused.
  failed;

  /// Whether the local connection is established, whatever came after.
  bool get isLinked => index >= PairingPhase.connected.index && this != failed;
}

/// What a TQRCG carries.
///
/// The real payload is a sealed envelope holding this account's identity and a
/// single-use pairing secret; the headset reads it off the screen and answers.
/// This type keeps [token] opaque so no screen can start depending on its
/// shape before the real protocol exists.
class TqrcgPayload {
  const TqrcgPayload({
    required this.token,
    required this.deviceId,
    required this.deviceName,
  });

  /// Opaque. The code view renders it and nothing else may — it is not to be
  /// parsed, read back to the user, or logged.
  final String token;

  final String deviceId;
  final String deviceName;
}

/// One step of a pairing, from either service.
class PairingProgress {
  const PairingProgress({
    required this.phase,
    required this.message,
    this.payload,
    this.failure,
    this.enrolmentHandle,
  });

  final PairingPhase phase;

  /// What to tell the user right now, in Nexa's voice.
  final String message;

  /// Present from [PairingPhase.showing] onwards — this is the code being
  /// shown on the phone's screen.
  final TqrcgPayload? payload;

  final String? failure;

  /// Present from [PairingPhase.connected] onwards, from [DeviceLinkService]
  /// specifically: the headset's own single-use enrolment handle, learned
  /// over whatever local transport carried it. Opaque here, exactly like
  /// [TqrcgPayload.token] — this field exists so the link stream can hand
  /// it to whatever calls `PairingSessionRepository.createPairingSession`
  /// next; nothing about the field name or its presence should be read,
  /// logged, or displayed as though it were meaningful on its own.
  final String? enrolmentHandle;

  /// Deliberately never includes [enrolmentHandle] or [payload]'s own
  /// token — matching `AuthSession`/`PairingSession`'s own redacting
  /// `toString()`. This is what a debugger or an accidental `print` sees
  /// instead.
  @override
  String toString() =>
      'PairingProgress(phase: $phase, message: $message, '
      'enrolmentHandle: ${enrolmentHandle == null ? 'null' : '<redacted>'}, '
      'payload: ${payload == null ? 'null' : '<redacted>'})';
}
