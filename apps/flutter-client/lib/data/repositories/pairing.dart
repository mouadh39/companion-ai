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

/// Where a discovered headset can be reached over the local network —
/// transport information, and only that.
///
/// ## This is not identity, and never proof of anything
///
/// A UDP source address is trivially spoofable by anything else on the same
/// network segment, so nothing about pairing's actual security may ever be
/// made to depend on this value being honest. The real trust boundary is
/// entirely downstream of it: the backend verifies a cryptographic
/// signature over a challenge it built itself
/// (`PairingSessionStore.redeem`, `verifyChallenge`) against a public key it
/// already had on file from enrolment — see the headset-side
/// `HeadsetPairingRedemptionRequestBuilder`'s own doc for the matching half
/// of that reasoning. This type exists purely so a phone can address one
/// UDP datagram back to the headset it is already trying to pair with; a
/// wrong or forged address here can make pairing fail (the reply goes
/// nowhere useful), never succeed illegitimately.
class HeadsetLanEndpoint {
  const HeadsetLanEndpoint({required this.host, required this.port});

  /// A textual IP address (e.g. `"192.168.1.42"`), not a hostname — exactly
  /// what a UDP datagram's sender address already is.
  final String host;
  final int port;

  /// Not secret — just not identity either. Included plainly, unlike
  /// [PairingProgress.enrolmentHandle].
  @override
  String toString() => 'HeadsetLanEndpoint($host:$port)';

  @override
  bool operator ==(Object other) =>
      other is HeadsetLanEndpoint && other.host == host && other.port == port;

  @override
  int get hashCode => Object.hash(host, port);
}

/// What this phone learned about one specific headset during discovery,
/// carried forward to the step that needs it to actually issue a code —
/// see the report on why [DeviceLinkService] and `TqrcgService` are
/// deliberately separate stages that share no state of their own, and why
/// this type is what closes that gap without merging the two.
///
/// Scoped to exactly one pairing attempt — `NexaAppState` holds at most one
/// of these at a time, tied to whichever single device the active pairing
/// flow concerns (its own `deviceId`), the same lifecycle its `pairingPhase`
/// already has. Two attempts are never simultaneous in this app's own UI (it
/// is a single wizard, one device at a time), so there is no second
/// in-flight context for one to be confused with; the cross-wiring risk this
/// exists to avoid is handled one layer down, in
/// `LocalTransportPairingLink`'s own wrong-device-name filtering — a context
/// is only ever built from an advertisement that already matched the device
/// being paired.
class HeadsetPairingContext {
  const HeadsetPairingContext({
    required this.enrolmentHandle,
    this.headsetEndpoint,
  });

  /// The handle learned from the matched advertisement — see
  /// [PairingProgress.enrolmentHandle]'s own doc on its sensitivity.
  final String enrolmentHandle;

  /// Where to reach that same headset over LAN, if the transport that
  /// discovered it could report one. Transport information only — see
  /// [HeadsetLanEndpoint]'s own doc.
  final HeadsetLanEndpoint? headsetEndpoint;

  /// Deliberately never includes [enrolmentHandle].
  @override
  String toString() =>
      'HeadsetPairingContext(enrolmentHandle: <redacted>, headsetEndpoint: $headsetEndpoint)';
}

/// One step of a pairing, from either service.
class PairingProgress {
  const PairingProgress({
    required this.phase,
    required this.message,
    this.payload,
    this.failure,
    this.enrolmentHandle,
    this.headsetEndpoint,
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

  /// Present from [PairingPhase.connected] onwards, when the underlying
  /// transport can report one — a LAN transport always can; a future BLE
  /// transport implementing [DeviceLinkService] might not be able to, and
  /// `null` here is exactly how it says so. See [HeadsetLanEndpoint]'s own
  /// doc on why this is transport information only, never proof of the
  /// device's identity.
  final HeadsetLanEndpoint? headsetEndpoint;

  /// Deliberately never includes [enrolmentHandle] or [payload]'s own
  /// token — matching `AuthSession`/`PairingSession`'s own redacting
  /// `toString()`. [headsetEndpoint] is included plainly; see its own doc
  /// on why it is not treated as sensitive. This is what a debugger or an
  /// accidental `print` sees instead.
  @override
  String toString() =>
      'PairingProgress(phase: $phase, message: $message, '
      'enrolmentHandle: ${enrolmentHandle == null ? 'null' : '<redacted>'}, '
      'headsetEndpoint: $headsetEndpoint, '
      'payload: ${payload == null ? 'null' : '<redacted>'})';
}
