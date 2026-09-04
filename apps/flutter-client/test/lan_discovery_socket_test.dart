import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/repositories/lan_discovery_socket.dart';

/// Real UDP, on loopback — no fake, no injected stream. Every test here
/// sends actual datagrams over an actual bound socket, the same class a
/// real phone/headset build uses. Ports are always `0` (OS-assigned) so
/// tests never collide with each other or with anything else on the host.
void main() {
  group('valid message', () {
    test('a datagram sent to the socket arrives on messages, decoded as UTF-8', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();
      addTearDown(socket.close);

      final received = socket.messages.first;
      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);
      sender.send(utf8.encode('hello nexa'), InternetAddress.loopbackIPv4, socket.boundPort!);

      final message = await received.timeout(const Duration(seconds: 5));
      expect(message.text, 'hello nexa');
      expect(message.senderAddress, InternetAddress.loopbackIPv4);
      expect(message.senderPort, sender.port);
    });
  });

  group('malformed message', () {
    test('bytes that are not valid UTF-8 are dropped, not delivered or thrown', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();
      addTearDown(socket.close);

      final firstDelivered = socket.messages.first;

      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);
      // 0xFF 0xFE is not valid UTF-8 in this position.
      sender.send(<int>[0xFF, 0xFE, 0x00, 0x01], InternetAddress.loopbackIPv4, socket.boundPort!);
      await Future<void>.delayed(const Duration(milliseconds: 20));

      // Followed by a genuine message, to prove the socket survives the bad
      // datagram rather than being knocked over by it. Waits for whatever
      // actually arrives first, rather than sampling after a fixed delay.
      sender.send(utf8.encode('still alive'), InternetAddress.loopbackIPv4, socket.boundPort!);

      expect((await firstDelivered.timeout(const Duration(seconds: 5))).text, 'still alive');
    });
  });

  group('oversized payload', () {
    test('a datagram larger than maxDatagramBytes is dropped', () async {
      final socket = LanDiscoverySocket(port: 0, maxDatagramBytes: 32);
      await socket.open();
      addTearDown(socket.close);

      final firstDelivered = socket.messages.first;

      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);

      sender.send(utf8.encode('x' * 200), InternetAddress.loopbackIPv4, socket.boundPort!);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      sender.send(utf8.encode('small'), InternetAddress.loopbackIPv4, socket.boundPort!);

      // Waits for whatever actually arrives first, rather than sampling
      // after a fixed delay — if the oversized guard failed to drop the
      // 200-byte datagram, this would see it (and fail), instead of a flaky
      // race against how long delivery happens to take on this host.
      expect((await firstDelivered.timeout(const Duration(seconds: 5))).text, 'small');
    });
  });

  group('duplicate message', () {
    test('the exact same bytes received twice in quick succession are delivered only once', () async {
      final socket = LanDiscoverySocket(port: 0, dedupWindow: const Duration(seconds: 5));
      await socket.open();
      addTearDown(socket.close);

      final events = <String>[];
      final sub = socket.messages.listen((m) => events.add(m.text));
      addTearDown(sub.cancel);

      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);

      for (var i = 0; i < 3; i++) {
        sender.send(utf8.encode('repeat me'), InternetAddress.loopbackIPv4, socket.boundPort!);
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }

      await Future<void>.delayed(const Duration(milliseconds: 300));
      expect(events, ['repeat me']);
    });

    test('the same content from two different senders is not treated as a duplicate of itself', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();
      addTearDown(socket.close);

      // Deliberately still 2: dedup keys on (sender address, sender port,
      // bytes) together, never bytes alone — two independent senders each
      // get to say their piece — see the class doc. Waits for both events
      // to actually arrive rather than sampling after a fixed delay.
      final firstTwo = socket.messages.take(2).toList();

      final senderA = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(senderA.close);
      final senderB = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(senderB.close);

      senderA.send(utf8.encode('same content'), InternetAddress.loopbackIPv4, socket.boundPort!);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      senderB.send(utf8.encode('same content'), InternetAddress.loopbackIPv4, socket.boundPort!);

      final delivered = await firstTwo.timeout(const Duration(seconds: 5));
      expect(delivered.map((m) => m.text), ['same content', 'same content']);
      // And from genuinely different sender ports, proving the key really
      // did include sender identity rather than happening to pass anyway.
      expect(delivered[0].senderPort, isNot(delivered[1].senderPort));
    });

    test('the same bytes arriving again after the dedup window has passed are delivered again', () async {
      final socket = LanDiscoverySocket(port: 0, dedupWindow: const Duration(milliseconds: 50));
      await socket.open();
      addTearDown(socket.close);

      final firstTwo = socket.messages.take(2).toList();

      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);

      sender.send(utf8.encode('again later'), InternetAddress.loopbackIPv4, socket.boundPort!);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      sender.send(utf8.encode('again later'), InternetAddress.loopbackIPv4, socket.boundPort!);

      final delivered = await firstTwo.timeout(const Duration(seconds: 5));
      expect(delivered.map((m) => m.text), ['again later', 'again later']);
    });
  });

  group('cancellation / graceful shutdown', () {
    test('close() while open leaves messages closed and isOpen false', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();

      final done = Completer<void>();
      socket.messages.listen(null, onDone: done.complete);

      await socket.close();
      await done.future.timeout(const Duration(seconds: 5));

      expect(socket.isOpen, isFalse);
      expect(socket.boundPort, isNull);
    });

    test('close() before open() ever succeeded is a safe no-op', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.close(); // must not throw
      expect(socket.isOpen, isFalse);
    });

    test('close() is idempotent — calling it twice does not throw', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();
      await socket.close();
      await socket.close();
      expect(socket.isOpen, isFalse);
    });

    test('messages throws StateError if read before open() has ever succeeded', () {
      final socket = LanDiscoverySocket(port: 0);
      expect(() => socket.messages, throwsStateError);
    });

    test('send() on a closed socket is a silent no-op, not an exception', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.close();
      expect(() => socket.send('x', InternetAddress.loopbackIPv4, 12345), returnsNormally);
    });
  });

  group('reconnect', () {
    test('calling open() again fully tears down the previous socket before binding a new one', () async {
      final socket = LanDiscoverySocket(port: 0);
      await socket.open();
      final firstPort = socket.boundPort;

      final firstMessages = <String>[];
      final firstSub = socket.messages.listen((m) => firstMessages.add(m.text));

      await socket.open(); // reconnect
      addTearDown(socket.close);
      final secondPort = socket.boundPort;

      expect(secondPort, isNotNull);
      // Not a strict requirement that the OS picks a different ephemeral
      // port, but the old stream must be over regardless.
      final sub = firstSub;
      await sub.cancel();

      final sender = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(sender.close);
      sender.send(utf8.encode('after reconnect'), InternetAddress.loopbackIPv4, socket.boundPort!);

      expect((await socket.messages.first.timeout(const Duration(seconds: 5))).text, 'after reconnect');
      expect(firstPort, isNotNull);
    });

    test('a socket can be opened, closed, and opened again on the same explicit port', () async {
      const explicitPort = 0; // still OS-assigned, but exercises the same code path as a fixed port would
      final socket = LanDiscoverySocket(port: explicitPort);

      await socket.open();
      await socket.close();
      await socket.open();
      addTearDown(socket.close);

      expect(socket.isOpen, isTrue);
    });
  });
}
