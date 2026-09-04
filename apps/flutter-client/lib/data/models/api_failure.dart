/// Why a call to the Nexa backend failed.
///
/// A closed set rather than a raw status code or the backend's own message,
/// for the same reason the backend itself collapses its auth failures into
/// one shape: a screen decides what to show from [kind] alone, and [message]
/// is always safe to put on screen or in a log — it is never the backend's
/// own error body, which may describe internals a client has no business
/// repeating.
enum NexaApiFailureKind {
  /// No response reached this device at all — offline, DNS, connection
  /// refused, TLS failure.
  network,

  /// The request was sent but nothing came back in time.
  timeout,

  /// The backend rejected the request itself — a malformed body, a field
  /// that failed validation. Retrying with the same input will not help.
  invalidRequest,

  /// No credential was presented, or it did not verify. Distinguished from
  /// [invalidRequest] because the right response differs: re-authenticate,
  /// not fix a field.
  unauthorized,

  /// The device is not on the account, or the resource is not this
  /// caller's. Kept apart from [unauthorized] so a caller can tell "who are
  /// you" from "you may not do that" — even though the backend itself often
  /// collapses these on purpose (see e.g. `PairingSessionStore.redeem`),
  /// this side still distinguishes what its own auth layer reports.
  forbidden,

  /// Too many attempts, too quickly.
  rateLimited,

  /// The backend accepted the request but failed while handling it.
  server,

  /// A response came back that this client cannot make sense of — not
  /// JSON, not the shape a typed model expects. Almost always a version
  /// mismatch between this client and the backend, not a transient fault.
  decodeFailed,

  /// Anything else. Kept narrow on purpose — a new kind should be added
  /// above rather than a caller pattern-matching on `unknown` and hoping.
  unknown,
}

/// Every failure this app's Nexa API layer can raise.
///
/// [message] is written to be shown to a person or written to a log without
/// review — it never contains a request body, a header, a token, a
/// signature, or the backend's own response body. Callers that want to
/// react differently per failure switch on [kind], never parse [message].
class NexaApiException implements Exception {
  const NexaApiException(this.kind, this.message, {this.statusCode});

  final NexaApiFailureKind kind;
  final String message;

  /// The HTTP status that produced this, when there was one. Diagnostic
  /// only — no caller should branch on it instead of [kind].
  final int? statusCode;

  @override
  String toString() => 'NexaApiException(${kind.name}): $message';
}
