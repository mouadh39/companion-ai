import '../models/pairing_api.dart';
import 'nexa_api_client.dart';

/// The Nexa backend's device and pairing endpoints, typed one method per
/// route.
///
/// This is the smallest thing that can replace the mocked
/// [TqrcgService]/[DeviceLinkService] pair with real network calls — it
/// does not implement either interface itself, and does not decide when a
/// call happens. What it owns is narrower: turning each documented endpoint
/// into a typed Dart method, and nothing beyond that. A future service that
/// drives the actual pairing UI composes this rather than talking to
/// [NexaApiClient] directly, the same way every repository in this app sits
/// between a screen and a data source.
///
/// ## What this class will never do
///
/// It holds no P-256 private key and signs nothing — [redeemPairingSession]
/// and [refreshDeviceToken] both take an already-computed [signature],
/// because only a headset ever legitimately produces one (see
/// `NEXA_DEVICE_TOKEN_SECRET` and `buildRefreshChallenge` on the backend).
/// This app has no Android Keystore integration yet and must not invent a
/// signature to satisfy either call.
///
/// It persists nothing. [DeviceCredentials] returned from here are handed
/// back to the caller and never written to disk, `SharedPreferences`, or
/// any other store by this class — a device's own credentials belong to
/// that device, not to the phone that happened to relay a call for it.
class NexaBackend {
  const NexaBackend(this._client);

  final NexaApiClient _client;

  /// `POST /v1/devices` — registers this phone as a device on the
  /// authenticated account.
  ///
  /// [bearerToken] is a Supabase access token. Getting one is not this
  /// class's job — this app has no Supabase session yet, so today's only
  /// caller is a test supplying one directly. Nothing about that boundary
  /// changes when real sign-in exists: this method still just takes a
  /// token and sends it.
  Future<RegisteredDevice> registerDevice({
    required String bearerToken,
    String? label,
  }) async {
    final json = await _client.postJson(
      '/v1/devices',
      bearerToken: bearerToken,
      body: {if (label != null) 'label': label},
    );
    return RegisteredDevice.fromJson(json);
  }

  /// `POST /v1/device-enrolments` — unauthenticated. Publishes a P-256
  /// public key and gets back a single-use handle for it.
  ///
  /// The phone is not expected to ever call this in the real flow — a
  /// headset enrols itself, with a key this app never holds — but the
  /// method exists so the typed surface matches every endpoint the backend
  /// documents, and so a test can exercise the whole contract without a
  /// second, ad hoc client.
  Future<DeviceEnrolment> createDeviceEnrolment({
    required String publicKeyBase64,
    String? keySecurityLevel,
  }) async {
    final json = await _client.postJson(
      '/v1/device-enrolments',
      body: {
        'publicKey': publicKeyBase64,
        if (keySecurityLevel != null) 'keySecurityLevel': keySecurityLevel,
      },
    );
    return DeviceEnrolment.fromJson(json);
  }

  /// `POST /v1/pairing-sessions` — an authenticated phone turns an
  /// enrolment handle it has learned (over whatever local channel eventually
  /// carries it) into a pairing code to display.
  Future<PairingSession> createPairingSession({
    required String bearerToken,
    required String phoneDeviceId,
    required String enrolmentHandle,
  }) async {
    final json = await _client.postJson(
      '/v1/pairing-sessions',
      bearerToken: bearerToken,
      body: {
        'phoneDeviceId': phoneDeviceId,
        'enrolmentHandle': enrolmentHandle,
      },
    );
    return PairingSession.fromJson(json);
  }

  /// `GET /v1/pairing-sessions/:id/status` — the phone's only authoritative
  /// way to learn a headset actually redeemed. Never call this speculatively
  /// with an id this account did not create: the backend answers "not
  /// found" for a session that exists but belongs to someone else exactly
  /// as it does for one that never existed at all, by design — see the
  /// route's own doc.
  Future<PairingSessionStatus> getPairingSessionStatus({
    required String bearerToken,
    required String pairingSessionId,
  }) async {
    final json = await _client.getJson(
      '/v1/pairing-sessions/${Uri.encodeComponent(pairingSessionId)}/status',
      bearerToken: bearerToken,
    );
    return PairingSessionStatus.fromJson(json);
  }

  /// `POST /v1/pairing-sessions/redeem` — unauthenticated. A headset
  /// presents the code it read and a signature proving it holds the private
  /// key that key's enrolment was published for.
  ///
  /// [signature] must already be computed — base64, ASN.1 DER, exactly as
  /// `buildChallenge` on the backend expects. Never call this with a
  /// placeholder or synthetic signature: a wrong one fails safely, but this
  /// method has no way to tell "not implemented yet" apart from "someone is
  /// probing the endpoint," and the backend rate-limits both alike.
  Future<RedeemedPairing> redeemPairingSession({
    required String code,
    required String signature,
  }) async {
    final json = await _client.postJson(
      '/v1/pairing-sessions/redeem',
      body: {'code': code, 'signature': signature},
    );
    return RedeemedPairing.fromJson(json);
  }

  /// `POST /v1/devices/token/refresh` — unauthenticated. Rotates a still-live
  /// refresh token, proven with a fresh signature over it, for a new pair.
  ///
  /// Same signing rule as [redeemPairingSession]: [signature] is the
  /// caller's responsibility entirely.
  Future<DeviceCredentials> refreshDeviceToken({
    required String refreshToken,
    required String signature,
  }) async {
    final json = await _client.postJson(
      '/v1/devices/token/refresh',
      body: {'refreshToken': refreshToken, 'signature': signature},
    );
    return DeviceCredentials.fromJson(json);
  }
}
