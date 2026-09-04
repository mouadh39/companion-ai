/// Typed request and response shapes for the Nexa backend's device and
/// pairing endpoints (Step 3D/3E).
///
/// One class per endpoint response, matching the backend's own field names
/// exactly — see `apps/backend/src/server.ts`, which is the source of truth
/// this file was written against. Nothing here invents a field the backend
/// does not send, and nothing here is optional unless the backend's own
/// route makes it so.
library;

/// A device the account owns, as `POST /v1/devices` returns it after
/// registering the phone this app is running on.
class RegisteredDevice {
  const RegisteredDevice({
    required this.deviceId,
    required this.kind,
    required this.label,
    required this.registeredAt,
  });

  factory RegisteredDevice.fromJson(Map<String, dynamic> json) =>
      RegisteredDevice(
        deviceId: json['deviceId'] as String,
        kind: json['kind'] as String,
        label: json['label'] as String?,
        registeredAt: DateTime.parse(json['registeredAt'] as String),
      );

  final String deviceId;

  /// `'phone'` for this route — carried as the backend sends it rather than
  /// hard-coded, so a shape mismatch surfaces as a decode failure instead of
  /// being silently papered over.
  final String kind;

  final String? label;
  final DateTime registeredAt;
}

/// What a headset receives from `POST /v1/device-enrolments` after
/// publishing its P-256 public key.
///
/// The phone never calls this route — an enrolment is created by the
/// headset, over its own connection, with no credential of its own. This
/// type exists on the phone side only so the pairing API surface is
/// complete and typed end to end; nothing in this app is expected to
/// construct one outside a test.
class DeviceEnrolment {
  const DeviceEnrolment({
    required this.enrolmentId,
    required this.handle,
    required this.expiresAt,
  });

  factory DeviceEnrolment.fromJson(Map<String, dynamic> json) =>
      DeviceEnrolment(
        enrolmentId: json['enrolmentId'] as String,
        handle: json['handle'] as String,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );

  final String enrolmentId;

  /// The plaintext handle the headset holds up as its half of the pairing
  /// exchange — opaque here, never logged, never persisted by this app.
  final String handle;

  final DateTime expiresAt;
}

/// A pairing session, as `POST /v1/pairing-sessions` hands it back to an
/// authenticated phone.
class PairingSession {
  const PairingSession({
    required this.pairingSessionId,
    required this.code,
    required this.expiresAt,
  });

  factory PairingSession.fromJson(Map<String, dynamic> json) =>
      PairingSession(
        pairingSessionId: json['pairingSessionId'] as String,
        code: json['code'] as String,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );

  final String pairingSessionId;

  /// `NX2.<secret>` — exactly what this phone displays for the headset's
  /// camera to read. Never a Supabase token, never a device credential: see
  /// the module doc on why nothing else may ever go into that code. Treat
  /// as a secret: never logged, never persisted beyond what showing it on
  /// screen requires, never sent anywhere but back to
  /// `POST /v1/pairing-sessions/redeem` — and this app does not even do
  /// that; only a headset ever legitimately presents it.
  final String code;

  /// The backend's own 2-minute TTL for this session — never recomputed or
  /// assumed here, only read. Whatever displays [code] is responsible for
  /// respecting it; this type only carries the fact.
  final DateTime expiresAt;

  /// Whether the backend's own expiry has passed, as of [now] (defaulting
  /// to the real clock). A UI or transport layer enforcing the pairing
  /// window reads this rather than re-deriving "2 minutes" itself — the
  /// backend is the one authority on how long a session lives, and this
  /// only ever reflects what it said.
  bool isExpired({DateTime? now}) => (now ?? DateTime.now()).isAfter(expiresAt);

  /// Deliberately never includes [code] — see its own doc on why. This is
  /// what a debugger, a log line, or an accidental `print` sees instead.
  @override
  String toString() =>
      'PairingSession(pairingSessionId: $pairingSessionId, '
      'expiresAt: $expiresAt, code: <redacted>)';
}

/// The headset's own credentials, in the one shape both endpoints that ever
/// issue them share: a successful redemption and a successful refresh.
///
/// This app has no reason to ever hold one of these — it has no headset
/// private key to sign a refresh proof with, so it can never legitimately
/// call `/v1/devices/token/refresh` itself. The type exists so a future
/// relay path (over whatever local transport eventually exists) has
/// somewhere typed to decode into, rather than passing raw maps around.
class DeviceCredentials {
  const DeviceCredentials({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory DeviceCredentials.fromJson(Map<String, dynamic> json) =>
      DeviceCredentials(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
        expiresIn: json['expiresIn'] as int,
      );

  /// The headset's `nexa-device` access JWT. Never logged, never put in a
  /// QR, never written to disk by this app.
  final String accessToken;

  /// Plaintext, valid for exactly one further refresh. Same handling rules
  /// as [accessToken].
  final String refreshToken;

  final int expiresIn;
}

/// What `POST /v1/pairing-sessions/redeem` returns on success: a
/// [DeviceCredentials] plus the `deviceId` the headset was just registered
/// under, and the `paired: true` flag the backend always sends alongside it.
class RedeemedPairing {
  const RedeemedPairing({
    required this.deviceId,
    required this.credentials,
  });

  factory RedeemedPairing.fromJson(Map<String, dynamic> json) =>
      RedeemedPairing(
        deviceId: json['deviceId'] as String,
        credentials: DeviceCredentials.fromJson(json),
      );

  final String deviceId;
  final DeviceCredentials credentials;
}
