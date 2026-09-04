import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/headset_advertisement.dart';
import 'package:nexa_client/data/repositories/lan_discovery_socket.dart';
import 'package:nexa_client/data/repositories/local_transport_link.dart';
import 'package:nexa_client/data/repositories/pairing.dart';

HeadsetAdvertisement _advert({
  String deviceName = 'Meta Quest 3',
  String enrolmentHandle = 'the-secret-enrolment-handle',
  DateTime? issuedAt,
}) => HeadsetAdvertisement(
  deviceName: deviceName,
  enrolmentHandle: enrolmentHandle,
  issuedAt: issuedAt ?? DateTime.now(),
);

/// Wraps already-encoded wire text as a [LanTransportMessage] "from"
/// [address]:[port] — the same shape a real [LanDiscoverySocket] delivers.
LanTransportMessage _received(
  String text, {
  String address = '192.168.1.50',
  int port = 47332,
}) => LanTransportMessage(
  text: text,
  senderAddress: InternetAddress(address),
  senderPort: port,
);

void main() {
  group('HeadsetAdvertisementCodec', () {
    test('round-trips through encode/decode', () {
      final original = _advert();
      final decoded = HeadsetAdvertisementCodec.decode(
        HeadsetAdvertisementCodec.encode(original),
      );

      expect(decoded, isNotNull);
      expect(decoded!.deviceName, original.deviceName);
      expect(decoded.enrolmentHandle, original.enrolmentHandle);
      expect(decoded.issuedAt, original.issuedAt);
    });

    test('decode returns null for a string that is not JSON at all', () {
      expect(HeadsetAdvertisementCodec.decode('not json'), isNull);
    });

    test('decode returns null for well-formed JSON with the wrong magic', () {
      final raw = jsonEncode({
        'magic': 'some-other-protocol-v1',
        'deviceName': 'Meta Quest 3',
        'enrolmentHandle': 'x',
        'issuedAt': DateTime.now().toIso8601String(),
      });
      expect(HeadsetAdvertisementCodec.decode(raw), isNull);
    });

    test('decode returns null for the right magic but a missing field', () {
      final raw = jsonEncode({
        'magic': 'nexa.pairing.v1',
        'deviceName': 'Meta Quest 3',
        // enrolmentHandle and issuedAt both missing
      });
      expect(HeadsetAdvertisementCodec.decode(raw), isNull);
    });

    test('decode returns null for a JSON array instead of an object', () {
      expect(HeadsetAdvertisementCodec.decode('[1,2,3]'), isNull);
    });

    test('decode returns null for an empty string', () {
      expect(HeadsetAdvertisementCodec.decode(''), isNull);
    });
  });

  group('LocalTransportPairingLink — discovery state transitions', () {
    test('emits discovering immediately, then deviceFound then connected on a matching advertisement', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(openMessages: () => messages.stream);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link
          .link(deviceId: 'quest3', deviceName: 'Meta Quest 3')
          .listen(events.add, onDone: done.complete);

      await Future<void>.delayed(Duration.zero);
      expect(events.map((e) => e.phase), [PairingPhase.discovering]);

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await done.future;

      expect(events.map((e) => e.phase), [
        PairingPhase.discovering,
        PairingPhase.deviceFound,
        PairingPhase.connected,
      ]);
      expect(events.last.enrolmentHandle, 'the-secret-enrolment-handle');
    });

    test('connection success carries the enrolment handle from the matched advertisement, and nothing else does', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(openMessages: () => messages.stream);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert(enrolmentHandle: 'handle-abc'))));
      await done.future;

      for (final e in events) {
        if (e.phase == PairingPhase.connected) {
          expect(e.enrolmentHandle, 'handle-abc');
        } else {
          expect(e.enrolmentHandle, isNull);
        }
      }
    });
  });

  group('headset LAN endpoint propagation', () {
    test('a matched advertisement carries the sender address and port forward as headsetEndpoint', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(openMessages: () => messages.stream);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(
        _received(
          HeadsetAdvertisementCodec.encode(_advert()),
          address: '10.0.0.42',
          port: 47332,
        ),
      );
      await done.future;

      final connected = events.firstWhere((e) => e.phase == PairingPhase.connected);
      expect(connected.headsetEndpoint, const HeadsetLanEndpoint(host: '10.0.0.42', port: 47332));
    });

    test('every phase before connected carries no headset endpoint', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(openMessages: () => messages.stream);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await done.future;

      for (final e in events) {
        if (e.phase != PairingPhase.connected) {
          expect(e.headsetEndpoint, isNull);
        }
      }
    });

    test('two different discovered headsets never cross-wire their endpoints', () async {
      // Two separate link() attempts, each fed its own message stream —
      // exactly the shape of pairing two different devices one after
      // another. Each must carry only its own headset's address forward.
      final firstMessages = StreamController<LanTransportMessage>();
      final firstLink = LocalTransportPairingLink(openMessages: () => firstMessages.stream);
      final firstEvents = <PairingProgress>[];
      final firstDone = Completer<void>();
      firstLink.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        firstEvents.add,
        onDone: firstDone.complete,
      );
      firstMessages.add(
        _received(HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest 3')), address: '10.0.0.1'),
      );
      await firstDone.future;

      final secondMessages = StreamController<LanTransportMessage>();
      final secondLink = LocalTransportPairingLink(openMessages: () => secondMessages.stream);
      final secondEvents = <PairingProgress>[];
      final secondDone = Completer<void>();
      secondLink.link(deviceId: 'quest-pro', deviceName: 'Meta Quest Pro').listen(
        secondEvents.add,
        onDone: secondDone.complete,
      );
      secondMessages.add(
        _received(HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest Pro')), address: '10.0.0.2'),
      );
      await secondDone.future;

      final firstConnected = firstEvents.firstWhere((e) => e.phase == PairingPhase.connected);
      final secondConnected = secondEvents.firstWhere((e) => e.phase == PairingPhase.connected);
      expect(firstConnected.headsetEndpoint?.host, '10.0.0.1');
      expect(secondConnected.headsetEndpoint?.host, '10.0.0.2');
    });

    test('a wrong-device advertisement\'s address is never captured, even though it arrived', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(milliseconds: 60),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(
        _received(
          HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest 3S')),
          address: '10.0.0.99',
        ),
      );
      await done.future; // times out — the wrong-device message never matched

      expect(events.any((e) => e.headsetEndpoint != null), isFalse);
    });
  });

  group('timeout', () {
    test('emits failed and closes when nothing matches within the timeout', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(milliseconds: 30),
      );

      final events = await link
          .link(deviceId: 'quest3', deviceName: 'Meta Quest 3')
          .toList();

      expect(events.map((e) => e.phase), [
        PairingPhase.discovering,
        PairingPhase.failed,
      ]);
      expect(events.last.failure, isNotNull);
    });

    test('a matching advertisement arriving after the timeout has already fired is not delivered', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(milliseconds: 20),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      await Future<void>.delayed(const Duration(milliseconds: 40));
      // Too late — the stream should already be closed with `failed`.
      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await done.future;

      expect(events.map((e) => e.phase), [
        PairingPhase.discovering,
        PairingPhase.failed,
      ]);
    });
  });

  group('wrong-device rejection at the protocol level', () {
    test('an advertisement from a differently-named device is ignored, not treated as a connection', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(milliseconds: 60),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest 3S'))));
      await done.future; // times out — the wrong-device message never matched

      expect(events.any((e) => e.phase == PairingPhase.connected), isFalse);
      expect(events.last.phase, PairingPhase.failed);
    });

    test('the right device after a wrong one still connects', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(seconds: 5),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest 3S'))));
      await Future<void>.delayed(Duration.zero);
      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert(deviceName: 'Meta Quest 3'))));
      await done.future;

      expect(events.last.phase, PairingPhase.connected);
      expect(events.last.enrolmentHandle, isNotNull);
    });
  });

  group('malformed transport messages', () {
    test('garbage on the wire is ignored — no crash, no false connection', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(milliseconds: 60),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received('not json at all'));
      messages.add(_received(jsonEncode({'unrelated': 'payload'})));
      await done.future; // times out — nothing valid ever arrived

      expect(events.any((e) => e.phase == PairingPhase.connected), isFalse);
      expect(events.last.phase, PairingPhase.failed);
    });

    test('a malformed message followed by a genuine one still connects', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(seconds: 5),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received('garbage'));
      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await done.future;

      expect(events.last.phase, PairingPhase.connected);
    });
  });

  group('cancel', () {
    test('cancel() closes an in-flight link stream with no further events', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(
        openMessages: () => messages.stream,
        timeout: const Duration(seconds: 5),
      );

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      await link.cancel();
      await done.future;

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(events.any((e) => e.phase == PairingPhase.connected), isFalse);
    });

    test('a second link() call tears down the first one', () async {
      final firstMessages = StreamController<LanTransportMessage>();
      final secondMessages = StreamController<LanTransportMessage>();
      var callCount = 0;
      final link = LocalTransportPairingLink(
        openMessages: () {
          callCount++;
          return callCount == 1 ? firstMessages.stream : secondMessages.stream;
        },
        timeout: const Duration(seconds: 5),
      );

      final firstEvents = <PairingProgress>[];
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(firstEvents.add);
      await Future<void>.delayed(Duration.zero);

      final secondEvents = <PairingProgress>[];
      final secondDone = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        secondEvents.add,
        onDone: secondDone.complete,
      );

      secondMessages.add(_received(HeadsetAdvertisementCodec.encode(_advert())));
      await secondDone.future;

      expect(secondEvents.last.phase, PairingPhase.connected);
      // The first stream never received the second's advertisement.
      expect(firstEvents.any((e) => e.phase == PairingPhase.connected), isFalse);
    });
  });

  group('secrets never leak into PairingProgress\'s own representation', () {
    test('toString() never contains the enrolment handle', () async {
      final messages = StreamController<LanTransportMessage>();
      final link = LocalTransportPairingLink(openMessages: () => messages.stream);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      link.link(deviceId: 'quest3', deviceName: 'Meta Quest 3').listen(
        events.add,
        onDone: done.complete,
      );

      messages.add(_received(HeadsetAdvertisementCodec.encode(_advert(enrolmentHandle: 'super-secret-handle'))));
      await done.future;

      final connected = events.firstWhere((e) => e.phase == PairingPhase.connected);
      expect(connected.enrolmentHandle, 'super-secret-handle');
      expect(connected.toString(), isNot(contains('super-secret-handle')));
      expect(connected.toString(), contains('redacted'));
    });
  });
}
