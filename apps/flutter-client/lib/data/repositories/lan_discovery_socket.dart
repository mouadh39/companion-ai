import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// One datagram [LanDiscoverySocket] accepted past its own guards, decoded
/// to text, together with who sent it.
///
/// The sender's address and port are transport information only — see
/// `HeadsetLanEndpoint` in `pairing.dart` for the full reasoning on why a
/// UDP source address must never be treated as proof of anything. They are
/// carried here purely so a caller that wants to reply (send a
/// `pairing_context` message back to the headset that is expecting one) has
/// somewhere to address it — see [LanDiscoverySocket.send].
class LanTransportMessage {
  const LanTransportMessage({
    required this.text,
    required this.senderAddress,
    required this.senderPort,
  });

  final String text;
  final InternetAddress senderAddress;
  final int senderPort;
}

/// A real UDP socket carrying Nexa's local pairing traffic — the transport
/// [LocalTransportPairingLink] interprets, and the thing that did not exist
/// before this step (see the report on why 3F-E deliberately stopped short
/// of this).
///
/// ## What this class is responsible for, and what it deliberately is not
///
/// Everything here is about getting bytes across a hostile local network
/// safely: opening and closing a real socket, dropping datagrams too large
/// to plausibly be a genuine message before they are even decoded as UTF-8,
/// suppressing an exact duplicate of a datagram already delivered a moment
/// ago (ordinary on a shared broadcast network, where a sender may repeat
/// itself and more than one receiver's own retransmission can echo back),
/// and turning a raw datagram into the same kind of `String` stream
/// [LocalTransportPairingLink] already consumes. It knows nothing about
/// what an advertisement, a pairing code, or a headset identity is — that
/// interpretation is [PairingLanEnvelope] and [HeadsetAdvertisementCodec]'s
/// job, kept strictly downstream of this class so this one stays testable
/// against nothing but real UDP traffic on loopback.
///
/// ## Why UDP, and why broadcast
///
/// A headset in pairing mode has no address a phone already knows — the
/// entire point of this transport is to be *found*. UDP broadcast is the
/// standard shape for that: a headset repeatedly broadcasts on
/// [defaultPort], and any phone listening on the same port and the same
/// local network segment receives it, with no prior connection needed. This
/// class supports the receiving side generally (used by both a phone
/// listening for a headset's advertisement, and — later — a headset
/// listening for a phone's reply) and a [send] method for the reply
/// direction, which is unicast (sent to one already-learned address, not
/// broadcast) — see the report on why only discovery itself needs to be
/// broadcast.
///
/// ## Duplicate suppression, precisely
///
/// A short in-memory window keyed by *both* the sender's address and port
/// and the exact bytes received — the same content from two different
/// senders is not the same message and must not be conflated with a real
/// duplicate, so sender identity is always part of the key, never bytes
/// alone. Anything matching both, still within [dedupWindow] of its first
/// sighting, is dropped before it ever reaches a listener. This is
/// transport-level noise reduction, not a security boundary — nothing about
/// pairing's actual trust depends on it; a genuine duplicate simply costs a
/// receiver one wasted decode-and-reject cycle if this dropped nothing at
/// all.
class LanDiscoverySocket {
  LanDiscoverySocket({
    this.port = defaultPort,
    this.maxDatagramBytes = 4096,
    this.dedupWindow = const Duration(seconds: 2),
  });

  /// Not IANA-registered — a high, unassigned-range port picked for Nexa's
  /// own local pairing traffic. Documented here as the one place this
  /// number is defined; nothing else in this codebase should hardcode it
  /// again.
  static const defaultPort = 47332;

  final int port;
  final int maxDatagramBytes;
  final Duration dedupWindow;

  RawDatagramSocket? _socket;
  StreamController<LanTransportMessage>? _controller;
  final Map<String, DateTime> _recentDigests = {};

  /// Whether [open] has succeeded and [close] has not since been called.
  bool get isOpen => _socket != null;

  /// The port this socket is actually bound to once [open] has succeeded —
  /// ordinarily just [port], but genuinely useful when [port] was given as
  /// `0` and the OS picked one, which a test asking for an isolated,
  /// collision-free port relies on. `null` before [open] succeeds or after
  /// [close].
  int? get boundPort => _socket?.port;

  /// Binds a real UDP socket on [port] and starts listening. Safe to call
  /// again at any time, including while already open — a fresh call always
  /// tears down and replaces whatever came before it first (see [close]),
  /// the same "reconnect never leaks the old attempt" guarantee
  /// [LocalTransportPairingLink.link] already gives its own callers one
  /// layer up.
  Future<void> open() async {
    await close();

    final socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, port, reuseAddress: true);
    socket.broadcastEnabled = true;
    _socket = socket;

    final controller = StreamController<LanTransportMessage>();
    _controller = controller;

    socket.listen(
      (event) => _handleEvent(socket, controller, event),
      onDone: () {
        if (!controller.isClosed) controller.close();
      },
    );
  }

  void _handleEvent(
    RawDatagramSocket socket,
    StreamController<LanTransportMessage> controller,
    RawSocketEvent event,
  ) {
    if (event != RawSocketEvent.read) return;

    // A single `read` event only means "at least one datagram is waiting" —
    // it is not one event per datagram. Two datagrams that arrive close
    // enough together can be queued behind one event, and calling
    // `receive()` only once here would silently leave the second sitting
    // unread until some later event happened to drain it (or, worst case,
    // never). Draining in a loop until the socket genuinely has nothing
    // left is the documented way to use this API correctly.
    Datagram? datagram;
    while ((datagram = socket.receive()) != null) {
      _handleDatagram(controller, datagram!);
    }
  }

  void _handleDatagram(StreamController<LanTransportMessage> controller, Datagram datagram) {
    // Hostile-network guard, first: refuse anything too large to plausibly
    // be a genuine message before spending any more work on it.
    if (datagram.data.length > maxDatagramBytes) return;

    _pruneDedup();
    final key = _dedupKey(datagram);
    if (_recentDigests.containsKey(key)) return; // exact duplicate from the same sender, within the window
    _recentDigests[key] = DateTime.now();

    String text;
    try {
      text = utf8.decode(datagram.data);
    } on FormatException {
      return; // not even valid UTF-8 — hostile or corrupt, dropped silently
    }

    if (!controller.isClosed) {
      controller.add(
        LanTransportMessage(text: text, senderAddress: datagram.address, senderPort: datagram.port),
      );
    }
  }

  /// The stream of every datagram this socket has accepted past its own
  /// guards, decoded to text and paired with its sender — exactly the shape
  /// `LocalTransportPairingLink`'s `openMessages` seam expects. Throws
  /// [StateError] if called before [open] has ever succeeded; a caller that
  /// wants a fresh stream after a reconnect calls [open] again and reads
  /// this again, the same pattern `LocalTransportPairingLink` itself uses
  /// for its own `openMessages` callback.
  Stream<LanTransportMessage> get messages {
    final controller = _controller;
    if (controller == null) {
      throw StateError('LanDiscoverySocket.messages was read before open() succeeded.');
    }
    return controller.stream;
  }

  /// Sends [payload] as a single UTF-8 datagram to [address]:[targetPort] —
  /// unicast, to an address already learned from a prior received datagram,
  /// never broadcast. Does nothing if this socket is not currently open;
  /// a caller that races a send against a concurrent [close] gets silent,
  /// safe no-op rather than an exception on an already-torn-down socket.
  void send(String payload, InternetAddress address, int targetPort) {
    _socket?.send(utf8.encode(payload), address, targetPort);
  }

  /// Closes the socket and releases everything this instance holds.
  /// Idempotent and safe to call whether or not [open] ever succeeded — the
  /// graceful-shutdown path every caller of this class can reach for
  /// unconditionally, including as the first step of [open] itself.
  Future<void> close() async {
    _socket?.close();
    _socket = null;

    final controller = _controller;
    _controller = null;
    // Deliberately not awaited: a single-subscription StreamController that
    // has never had a listener attached can leave close()'s own future
    // unresolved, since there is no subscriber for the done event to be
    // delivered to. LocalTransportPairingLink's own `_teardown` established
    // this exact fire-and-forget pattern for the same reason.
    if (controller != null && !controller.isClosed) {
      unawaited(controller.close());
    }

    _recentDigests.clear();
  }

  void _pruneDedup() {
    final cutoff = DateTime.now().subtract(dedupWindow);
    _recentDigests.removeWhere((_, seenAt) => seenAt.isBefore(cutoff));
  }

  static String _dedupKey(Datagram datagram) {
    // Sender address and port, plus a fast rolling hash of the payload —
    // this only needs to distinguish "almost certainly the same message,
    // from the same sender, recently" for noise reduction, not to resist a
    // deliberate collision; nothing about pairing's real security rests on
    // this value being unpredictable or collision-resistant (see the class
    // doc's own note that this is not a security boundary).
    int hash = 17;
    for (final byte in datagram.data) {
      hash = (hash * 31 + byte) & 0x7fffffff;
    }
    return '${datagram.address.address}:${datagram.port}:$hash';
  }
}
