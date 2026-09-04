import '../models/pairing_api.dart';
import 'auth_session_repository.dart';
import 'nexa_backend.dart';
import 'phone_device_repository.dart';

/// Turns a headset's enrolment handle into a pairing session this phone can
/// display, against `POST /v1/pairing-sessions`.
///
/// ## What this class does not do
///
/// It does not learn an enrolment handle itself — [createPairingSession]
/// takes one as a plain, required `String` argument. That argument *is* the
/// seam: the real local transport (Bluetooth, eventually) that discovers a
/// nearby headset and reads its published handle does not exist yet, and
/// this class does not guess at its shape. No `EnrolmentHandleSource`
/// interface, no scanning callback, nothing — inventing one now, before
/// there is a real implementation to design it against, is exactly the
/// speculative abstraction this step is asked not to build. When that
/// transport exists, its own code calls this method with the handle it
/// read; nothing about this class needs to change for that to happen.
///
/// It does not render, encode, or even look inside [PairingSession.code].
/// It has no dependency on `TqrcgService`, `TqrcgPayload`, or anything QR.
/// A future `TqrcgService` implementation composes this repository, not the
/// other way around — the same relationship `NexaBackend` already has to
/// every screen that will eventually call it.
///
/// It does not retry, cache, or de-duplicate calls the way
/// [PhoneDeviceRepository.ensureRegistered] does. A pairing session is not
/// an idempotent "do I already have one" resource the way a phone's own
/// device row is: every call is a genuine request for a new session over a
/// specific, single-use handle, and the backend's own atomic consumption of
/// that handle (`PairingSessionStore.create`) is already what makes two
/// concurrent calls over the *same* handle resolve to exactly one success —
/// see the test suite. Adding a client-side lock here would only hide that
/// guarantee working, not add one of its own.
class PairingSessionRepository {
  PairingSessionRepository({
    NexaBackend? backend,
    required AuthTokenProvider tokenProvider,
    required PhoneDeviceRepository phoneDevice,
  }) : _backend = backend,
       _tokens = tokenProvider,
       _phoneDevice = phoneDevice;

  final NexaBackend? _backend;
  final AuthTokenProvider _tokens;
  final PhoneDeviceRepository _phoneDevice;

  /// Creates a pairing session for [enrolmentHandle] on this phone's own
  /// device row, resolving `phoneDeviceId` from [PhoneDeviceRepository]
  /// rather than asking the caller to supply one — registering a device
  /// first if this installation does not already have one for whoever is
  /// signed in (see `PhoneDeviceRepository.ensureRegistered`).
  ///
  /// Throws [NotAuthenticatedException] if nobody is signed in, and
  /// [BackendNotConfiguredException] if this build has no [NexaBackend] —
  /// both checked, and the network never touched, before anything is sent.
  /// A refused or already-consumed [enrolmentHandle] surfaces as an
  /// ordinary [NexaApiException] from `NexaBackend.createPairingSession`;
  /// this method neither retries nor generates a replacement — the caller
  /// decides what a failed attempt means for whatever local transport is
  /// driving it.
  Future<PairingSession> createPairingSession({
    required String enrolmentHandle,
  }) async {
    final backend = _backend;
    if (backend == null) throw const BackendNotConfiguredException();

    final token = await _tokens.validAccessToken();
    if (token == null) throw const NotAuthenticatedException();

    final phoneDeviceId = await _phoneDevice.ensureRegistered();

    return backend.createPairingSession(
      bearerToken: token,
      phoneDeviceId: phoneDeviceId,
      enrolmentHandle: enrolmentHandle,
    );
  }
}
