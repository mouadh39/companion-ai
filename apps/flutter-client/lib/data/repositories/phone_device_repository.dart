import '../models/phone_device.dart';
import 'auth_session_repository.dart';
import 'nexa_backend.dart';
import 'phone_device_store.dart';

export 'auth_session_repository.dart' show NotAuthenticatedException;

/// Raised when this build has no [NexaBackend] to call — no base URL was
/// configured for it, the same way [AuthSessionRepository] has no
/// [SupabaseAuthClient] when no project was configured. Every build in this
/// repository right now is in that state; see the report.
class BackendNotConfiguredException implements Exception {
  const BackendNotConfiguredException();

  @override
  String toString() =>
      'BackendNotConfiguredException: no NexaBackend was supplied.';
}

/// This installation's own phone device row on the backend: registering it
/// once per account, remembering the id, and never confusing whose it is.
///
/// ## The shape of the problem
///
/// `POST /v1/devices` has exactly one behaviour: create a new device row for
/// whoever the bearer token names. It cannot be asked "do I already have
/// one" or "is the one I remember still good" — there is no such route.
/// Everything this class does exists to avoid needing one: [restore] loads
/// a previous run's result, [ensureRegistered] skips the call entirely when
/// a live one is already known, and [discardStoredDevice] gives a future
/// caller — one that eventually presents this id to some other
/// authenticated route and is told it is no good — a deterministic way to
/// clear it so the next [ensureRegistered] registers a fresh one instead of
/// repeating a call that would only fail the same way again.
///
/// ## Whose device this is
///
/// A `phoneDeviceId` by itself asserts nothing about which account it
/// belongs to — the backend never echoes a `userId` back (see
/// `RegisteredDevice`), by design. [restore] is therefore the one place a
/// stored id could be misapplied to the wrong account, and it refuses to:
/// a stored [LocalPhoneDevice] is only ever trusted when its own `userId`
/// matches [AuthenticatedIdentityProvider.currentUserId] exactly. A stored
/// id for a different account is left unloaded, not deleted — see
/// [restore]'s own doc for why that is the safe choice, not deleting it.
///
/// This repository supports one signed-in account's cached device id at a
/// time, by design: switching between two accounts on the same
/// installation re-registers a fresh device each time rather than juggling
/// several cached ids. Nothing in this app's product surface asks for
/// multi-account support on one phone, so this does not attempt it.
class PhoneDeviceRepository {
  PhoneDeviceRepository({
    required PhoneDeviceStore store,
    NexaBackend? backend,
    required AuthTokenProvider tokenProvider,
    required AuthenticatedIdentityProvider identity,
  }) : _store = store,
       _backend = backend,
       _tokens = tokenProvider,
       _identity = identity;

  final PhoneDeviceStore _store;
  final NexaBackend? _backend;
  final AuthTokenProvider _tokens;
  final AuthenticatedIdentityProvider _identity;

  String? _phoneDeviceId;

  /// Which account [_phoneDeviceId] was resolved for. Checked alongside it
  /// on every read — see [ensureRegistered] — so that signing in as a
  /// *different* account without an intervening [clearActiveDevice] (there
  /// is no UI path that does this yet, but nothing in this class may assume
  /// there never will be) can never hand that account the previous one's
  /// device id. A device id alone cannot carry this check itself: the
  /// backend never echoes a `userId` back (see `RegisteredDevice`).
  String? _cachedForUserId;

  Future<String>? _pending;

  /// This run's resolved device id, if [restore] or [ensureRegistered] has
  /// already found or created one for whoever is signed in right now.
  /// `null` otherwise — including right after [clearActiveDevice], even
  /// though a record may still be sitting in [PhoneDeviceStore].
  String? get phoneDeviceId => _phoneDeviceId;

  /// Loads a locally persisted device id into memory, if one exists **and**
  /// it was registered under the account that is signed in right now.
  ///
  /// Call once, at startup, after the auth session itself has been
  /// restored — [AuthenticatedIdentityProvider.currentUserId] has to be
  /// answerable before this can check anything against it.
  ///
  /// A stored record for a *different* account is deliberately left on
  /// disk rather than deleted: it names no account this method has any
  /// business erasing on that account's behalf, and it is harmless where it
  /// sits — every future [restore] re-applies the same identity check, so
  /// it can only ever be reused by the account it actually names.
  Future<void> restore() async {
    final stored = await _store.read();
    final userId = _identity.currentUserId;
    if (stored != null && userId != null && stored.userId == userId) {
      _phoneDeviceId = stored.phoneDeviceId;
      _cachedForUserId = userId;
    } else {
      _phoneDeviceId = null;
      _cachedForUserId = null;
    }
  }

  /// Returns this phone's device id for the signed-in account, calling
  /// `POST /v1/devices` only when this repository does not already hold a
  /// live one for that exact account. Concurrent calls before the first
  /// one resolves share its result rather than each registering their own
  /// device — see the module doc on why duplicate registrations must be
  /// avoided even within a single run.
  ///
  /// Throws [NotAuthenticatedException] if nobody is signed in.
  Future<String> ensureRegistered({String? label}) async {
    // `async` matters here beyond style: it is what turns the `throw` below
    // into a rejected Future rather than a synchronous exception thrown the
    // instant this method is called — every caller, `await`ing or not,
    // needs to be able to treat every failure this method has the same way.
    final userId = _identity.currentUserId;
    if (userId == null) throw const NotAuthenticatedException();

    final cached = _phoneDeviceId;
    if (cached != null && _cachedForUserId == userId) return cached;

    return _pending ??= _register(userId, label).whenComplete(() {
      _pending = null;
    });
  }

  Future<String> _register(String userId, String? label) async {
    final backend = _backend;
    if (backend == null) throw const BackendNotConfiguredException();

    final token = await _tokens.validAccessToken();
    if (token == null) throw const NotAuthenticatedException();

    final device = await backend.registerDevice(
      bearerToken: token,
      label: label,
    );

    _phoneDeviceId = device.deviceId;
    _cachedForUserId = userId;
    await _store.write(
      LocalPhoneDevice(userId: userId, phoneDeviceId: device.deviceId),
    );
    return device.deviceId;
  }

  /// Drops this run's active device id from memory, without touching what
  /// is on disk.
  ///
  /// Call on sign-out: the app is no longer acting as anyone, so it should
  /// not go on treating itself as having a registered device — but the
  /// persisted record is exactly the cache [restore] needs to skip a fresh
  /// registration if the *same* account signs back in, so it stays put.
  void clearActiveDevice() {
    _phoneDeviceId = null;
    _cachedForUserId = null;
  }

  /// Discards whatever local device state exists, in memory and on disk,
  /// so the next [ensureRegistered] registers a genuinely fresh device.
  ///
  /// Call this only when something has learned — from an authenticated
  /// call elsewhere that presented this device id and was refused for it —
  /// that the backend no longer considers it valid: revoked, or simply not
  /// found. This repository has no route of its own that could discover
  /// that on its own; the signal always comes from outside it.
  Future<void> discardStoredDevice() async {
    _phoneDeviceId = null;
    _cachedForUserId = null;
    await _store.clear();
  }
}
