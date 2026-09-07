/// The phone's reply to a headset's advertisement, once a pairing session
/// actually exists for it — the second (and, as of this step, last) message
/// type on Nexa's local pairing transport, alongside `HeadsetAdvertisement`.
///
/// ## Why this exists
///
/// A headset cannot build the signed challenge `POST /v1/pairing-sessions/redeem`
/// requires without knowing `pairingSessionId` — the backend resolves that id
/// itself from the code's hash and never accepts one from the client, so a
/// headset's own signature must already be computed against the exact id the
/// backend will resolve (see `HeadsetPairingRedemptionRequestBuilder`'s own
/// doc, Step 3F-I, for the full reasoning). The QR the phone displays carries
/// only `NX2.<secret>` — never a session id — so this message is the only
/// place a headset can learn it: sent by the phone, over the same local
/// channel the headset's own advertisement arrived on, once
/// `PairingSessionRepository.createPairingSession` has actually returned one.
///
/// ## What this message is not
///
/// It is not a credential and it is not authentication — see
/// `HeadsetPairingRedemptionRequestBuilder`'s own doc on why "QR scanned" (or,
/// here, "pairing context received") must never be collapsed into "paired."
/// A headset that receives a wrong or spoofed `pairingSessionId` simply
/// builds a challenge that will never verify at the backend; nothing about
/// this message being wrong or malicious grants anything by itself.
class PairingContextMessage {
  const PairingContextMessage({required this.pairingSessionId});

  factory PairingContextMessage.fromJson(Map<String, dynamic> json) =>
      PairingContextMessage(pairingSessionId: json['pairingSessionId'] as String);

  final String pairingSessionId;

  Map<String, dynamic> toJson() => {'pairingSessionId': pairingSessionId};
}
