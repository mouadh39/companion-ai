/// The one message a headset in pairing mode sends over the local
/// transport: enough for a nearby phone to notice it, tell it apart from a
/// different kind of device, and learn its enrolment handle.
///
/// Deliberately the entire local-transport protocol. There is no
/// handshake, no acknowledgement, no session state on the wire — the
/// backend already owns everything that matters about trust (see the
/// module doc on `PairingSessionRepository` and `buildRefreshChallenge`),
/// so this message only ever needs to carry what a phone needs to *find*
/// the right headset and *ask the backend* to do the rest.
///
/// Transport-neutral by design: nothing here assumes UDP, LAN, or any
/// specific radio. A concrete transport is responsible for getting the
/// encoded bytes from one device to the other; this type only defines what
/// those bytes mean once they arrive. See the accompanying report for why
/// LAN was selected as the transport this message is expected to travel
/// over first, and what would need to change here (nothing, structurally)
/// if a different transport were added later.
class HeadsetAdvertisement {
  const HeadsetAdvertisement({
    required this.deviceName,
    required this.enrolmentHandle,
    required this.issuedAt,
  });

  factory HeadsetAdvertisement.fromJson(Map<String, dynamic> json) =>
      HeadsetAdvertisement(
        deviceName: json['deviceName'] as String,
        enrolmentHandle: json['enrolmentHandle'] as String,
        issuedAt: DateTime.parse(json['issuedAt'] as String),
      );

  /// What the headset calls itself — e.g. "Meta Quest 3". Used only to let
  /// a phone tell apart which nearby headset is which; never trusted as
  /// proof of anything, and never the value compared against for the
  /// backend's own notion of device identity.
  final String deviceName;

  /// The plaintext handle from `POST /v1/device-enrolments`, exactly as
  /// the headset holds it. Short-lived and single-use on the backend's own
  /// terms — this message existing does not make it any more or less
  /// sensitive than it already is; see `PairingSessionRepository`'s module
  /// doc on why broadcasting it in the clear over the local network is an
  /// accepted exposure and not a new trust boundary.
  final String enrolmentHandle;

  /// When the headset minted this advertisement — not the enrolment's own
  /// expiry (the backend owns that), just enough for a receiver to prefer
  /// a fresher advertisement over a stale repeat of the same broadcast.
  final DateTime issuedAt;

  Map<String, dynamic> toJson() => {
    'deviceName': deviceName,
    'enrolmentHandle': enrolmentHandle,
    'issuedAt': issuedAt.toIso8601String(),
  };
}
