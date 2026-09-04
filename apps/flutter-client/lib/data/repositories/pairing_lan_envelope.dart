import 'dart:convert';

/// The one envelope every message on Nexa's local pairing transport is
/// wrapped in, independent of what kind of message it is.
///
/// ## Why this exists as its own layer, separate from [HeadsetAdvertisementCodec]
///
/// This transport now carries two message types — a headset's advertisement,
/// and a phone's `pairing_context` reply carrying `pairingSessionId` (see
/// `PairingContextCodec`) — and started with only the first. Retrofitting a
/// `type` discriminator onto an already-shipped flat wire format would have
/// been exactly the kind of breaking change this class exists to avoid
/// needing: nothing that already decodes today's advertisement wire bytes
/// stops working because of this, since a message with no `type` field is
/// still treated as `advertisement`, the only type that ever existed before
/// this field did.
///
/// ## What "hostile" means for this layer specifically
///
/// This is the first thing a raw string received off a real socket passes
/// through, before any per-message-type parsing even runs. Its whole job is
/// cheap, early rejection of input that is not even worth handing to a more
/// specific codec: too large to plausibly be a genuine message, not JSON at
/// all, not this protocol's `magic`, or naming a `type` this build has never
/// heard of. Every one of those is refused by returning `null` — never by
/// throwing — because a real local network delivers arbitrary noise
/// constantly and none of it is exceptional from this layer's point of view.
abstract final class PairingLanEnvelope {
  /// Fixed for as long as this protocol's fundamental shape does not change.
  /// A future incompatible redesign gets a new magic (the same convention
  /// the backend's own challenge domain tags use — see
  /// `apps/backend/src/devices/challenge.ts`'s `CHALLENGE_DOMAIN_TAG` /
  /// `REFRESH_CHALLENGE_DOMAIN_TAG`), not a version field flipped in place.
  static const magic = 'nexa.pairing.v1';

  /// Every message type this build of the codec knows how to route.
  static const supportedTypes = <String>{'advertisement', 'pairing_context'};

  /// A generous ceiling on the raw encoded string, checked before any UTF-8
  /// measurement or JSON parsing runs — the cheapest possible rejection of
  /// something that cannot plausibly be a genuine message. Every real
  /// message this protocol defines today is well under 1 KB; this is not
  /// tuned to that, it is tuned to "clearly not this," the same reasoning
  /// `PairingCodeValidator.MaxLength` documents for the same purpose on a
  /// different wire.
  static const maxEncodedChars = 4096;

  /// Parses [raw] as one envelope and returns its decoded JSON object if —
  /// and only if — every envelope-level check passes: small enough, valid
  /// JSON, a JSON object (not an array or scalar), the right [magic], and a
  /// recognised `type` (defaulted to `advertisement` when the field is
  /// absent, for exactly the backward-compatibility reason the class doc
  /// explains). Returns `null` for absolutely anything else — this method
  /// never throws for malformed input; a hostile or simply broken sender is
  /// not this app's exception to raise.
  ///
  /// The returned map is still entirely untrusted beyond having passed these
  /// shape checks — whichever per-type codec reads it from here (today, only
  /// [HeadsetAdvertisementCodec]) still validates every field it actually
  /// needs.
  static Map<String, dynamic>? decode(String raw) {
    if (raw.isEmpty) return null;
    if (raw.length > maxEncodedChars) return null;

    Object? json;
    try {
      json = jsonDecode(raw);
    } on FormatException {
      return null;
    }

    if (json is! Map<String, dynamic>) return null;
    if (json['magic'] != magic) return null;

    // `as String?` would itself throw a TypeError for a present-but-wrong-
    // typed value (e.g. `type: 123`) — checked explicitly here instead, so
    // a hostile or simply broken sender's wrong-shaped field is rejected
    // the same way every other malformed input is, never an uncaught throw.
    final rawType = json['type'];
    if (rawType != null && rawType is! String) return null;
    final type = (rawType as String?) ?? 'advertisement';
    if (!supportedTypes.contains(type)) return null;

    return json;
  }

  /// Wraps [payload]'s own fields with this envelope's [magic] and [type] —
  /// the exact inverse of what [decode] reads back off. [type] is written
  /// explicitly even for `advertisement`, the type that would be inferred by
  /// default anyway, so every message this codebase originates is
  /// self-describing on the wire — only messages from a build that predates
  /// this class rely on the default.
  static Map<String, dynamic> encode(
    String type,
    Map<String, dynamic> payload,
  ) => {'magic': magic, 'type': type, ...payload};
}
