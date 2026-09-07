import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/repositories/auth_session_repository.dart';
import 'package:nexa_client/data/repositories/lan_discovery_socket.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';
import 'package:nexa_client/data/repositories/pairing.dart';
import 'package:nexa_client/data/repositories/pairing_context_codec.dart';
import 'package:nexa_client/data/repositories/pairing_session_repository.dart';
import 'package:nexa_client/data/repositories/phone_device_repository.dart';
import 'package:nexa_client/data/repositories/phone_device_store.dart';
import 'package:nexa_client/data/repositories/real_tqrcg_service.dart';
import 'package:nexa_client/data/repositories/secure_key_value_store.dart';

class _FakeKeyValueStore implements SecureKeyValueStore {
  final Map<String, String> values = {};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
}

class _FakeIdentity implements AuthTokenProvider, AuthenticatedIdentityProvider {
  String? userId = 'user-1';
  String? token = 'phone-token';
  @override
  String? get currentUserId => userId;
  @override
  Future<String?> validAccessToken() async => token;
}

/// A router-style HTTP handler: create-session always succeeds with
/// [expiresAt]; status polls are answered in sequence from [statusSequence],
/// repeating the last entry once exhausted.
Future<http.Response> Function(http.Request) _router({
  DateTime? expiresAt,
  List<String> statusSequence = const ['pending'],
  int createStatusCode = 201,
}) {
  var pollIndex = 0;
  return (request) async {
    if (request.method == 'POST' && request.url.path == '/v1/devices') {
      return http.Response(
        jsonEncode({
          'deviceId': 'phone-1',
          'kind': 'phone',
          'label': null,
          'registeredAt': DateTime.now().toUtc().toIso8601String(),
        }),
        201,
      );
    }
    if (request.method == 'POST' && request.url.path == '/v1/pairing-sessions') {
      if (createStatusCode != 201) {
        return http.Response(jsonEncode({'error': 'invalid_request', 'message': 'nope'}), createStatusCode);
      }
      return http.Response(
        jsonEncode({
          'pairingSessionId': 'sess-1',
          'code': 'NX2.abc123',
          'expiresAt': (expiresAt ?? DateTime.now().toUtc().add(const Duration(minutes: 2))).toIso8601String(),
        }),
        201,
      );
    }
    if (request.method == 'GET' && request.url.path == '/v1/pairing-sessions/sess-1/status') {
      final status = statusSequence[pollIndex < statusSequence.length ? pollIndex : statusSequence.length - 1];
      pollIndex++;
      return http.Response(jsonEncode({'status': status, 'deviceId': status == 'redeemed' ? 'headset-1' : null}), 200);
    }
    throw StateError('unexpected request: ${request.method} ${request.url.path}');
  };
}

({RealTqrcgService service, LanDiscoverySocket lanSocket}) _harness({
  DateTime? expiresAt,
  List<String> statusSequence = const ['pending'],
  int createStatusCode = 201,
  Duration pollInterval = const Duration(milliseconds: 30),
}) {
  final api = NexaApiClient(
    baseUrl: Uri.parse('https://nexa.example/'),
    httpClient: MockClient(_router(expiresAt: expiresAt, statusSequence: statusSequence, createStatusCode: createStatusCode)),
  );
  final backend = NexaBackend(api);
  final identity = _FakeIdentity();
  final phoneDevice = PhoneDeviceRepository(
    store: PhoneDeviceStore(_FakeKeyValueStore()),
    backend: backend,
    tokenProvider: identity,
    identity: identity,
  );
  final pairingSession = PairingSessionRepository(
    backend: backend,
    tokenProvider: identity,
    phoneDevice: phoneDevice,
  );
  final lanSocket = LanDiscoverySocket(port: 0);
  final service = RealTqrcgService(
    pairingSession: pairingSession,
    lanSocket: lanSocket,
    pollInterval: pollInterval,
  );
  return (service: service, lanSocket: lanSocket);
}

const _context = HeadsetPairingContext(enrolmentHandle: 'the-handle');

void main() {
  group('no pairing context', () {
    test('fails immediately, with no HTTP call at all', () async {
      final h = _harness();
      addTearDown(h.service.cancel);

      final events = await h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: null)
          .toList();

      expect(events.map((e) => e.phase), [PairingPhase.failed]);
      expect(events.single.failure, 'no_pairing_context');
    });
  });

  group('creating the session', () {
    test('a successful create reaches issuing then showing, with the real code as the payload token', () async {
      final h = _harness();
      addTearDown(h.service.cancel);

      final events = <PairingProgress>[];
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add);
      addTearDown(sub.cancel);

      await Future<void>.delayed(const Duration(milliseconds: 10));

      expect(events.map((e) => e.phase), [PairingPhase.issuing, PairingPhase.showing]);
      expect(events.last.payload?.token, 'NX2.abc123');
      expect(events.last.payload?.deviceName, 'Meta Quest 3');
    });

    test('a refused create (e.g. an invalid handle) reaches failed, not showing', () async {
      final h = _harness(createStatusCode: 400);
      addTearDown(h.service.cancel);

      final events = await h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .toList();

      expect(events.map((e) => e.phase), [PairingPhase.issuing, PairingPhase.failed]);
      expect(events.last.failure, 'session_create_failed');
    });
  });

  group('authoritative completion — the whole point of this class', () {
    test('never reports paired until the backend status poll actually says redeemed', () async {
      final h = _harness(statusSequence: ['pending', 'pending', 'pending']);
      addTearDown(h.service.cancel);

      final events = <PairingProgress>[];
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add);
      addTearDown(sub.cancel);

      // Long enough for several poll ticks at the harness's fast interval.
      await Future<void>.delayed(const Duration(milliseconds: 150));

      expect(events.any((e) => e.phase == PairingPhase.paired), isFalse);
      expect(events.last.phase, PairingPhase.showing);
    });

    test('reports paired as soon as the backend reports redeemed', () async {
      final h = _harness(statusSequence: ['pending', 'redeemed']);
      addTearDown(h.service.cancel);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add, onDone: done.complete);
      addTearDown(sub.cancel);

      await done.future.timeout(const Duration(seconds: 5));

      expect(events.last.phase, PairingPhase.paired);
      expect(events.last.payload?.token, 'NX2.abc123');
    });

    test('an expired status reaches failed, not paired', () async {
      final h = _harness(statusSequence: ['pending', 'expired']);
      addTearDown(h.service.cancel);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add, onDone: done.complete);
      addTearDown(sub.cancel);

      await done.future.timeout(const Duration(seconds: 5));

      expect(events.last.phase, PairingPhase.failed);
      expect(events.any((e) => e.phase == PairingPhase.paired), isFalse);
    });

    test('a session already expired at creation time fails on the local TTL check, no poll needed', () async {
      final h = _harness(expiresAt: DateTime.now().toUtc().subtract(const Duration(minutes: 1)));
      addTearDown(h.service.cancel);

      final events = <PairingProgress>[];
      final done = Completer<void>();
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add, onDone: done.complete);
      addTearDown(sub.cancel);

      await done.future.timeout(const Duration(seconds: 5));

      expect(events.last.phase, PairingPhase.failed);
      expect(events.last.failure, 'expired');
    });
  });

  group('cancel()', () {
    test('stops the poll loop — no further events arrive after cancelling', () async {
      final h = _harness(statusSequence: ['pending', 'pending', 'redeemed']);

      final events = <PairingProgress>[];
      final sub = h.service
          .issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: _context)
          .listen(events.add);

      await Future<void>.delayed(const Duration(milliseconds: 10)); // past `showing`
      await h.service.cancel();
      final countAtCancel = events.length;

      await Future<void>.delayed(const Duration(milliseconds: 150)); // well past when `redeemed` would land
      await sub.cancel();

      expect(events.length, countAtCancel);
      expect(events.any((e) => e.phase == PairingPhase.paired), isFalse);
    });
  });

  group('sending pairing context over LAN', () {
    test('a real pairing_context datagram is sent to the discovered endpoint', () async {
      await Future<void>(() async {
        final api = NexaApiClient(
          baseUrl: Uri.parse('https://nexa.example/'),
          httpClient: MockClient(_router()),
        );
        final backend = NexaBackend(api);
        final identity = _FakeIdentity();
        final phoneDevice = PhoneDeviceRepository(
          store: PhoneDeviceStore(_FakeKeyValueStore()),
          backend: backend,
          tokenProvider: identity,
          identity: identity,
        );
        final pairingSession = PairingSessionRepository(
          backend: backend,
          tokenProvider: identity,
          phoneDevice: phoneDevice,
        );

        // The "phone's" real sending socket.
        final sendingSocket = LanDiscoverySocket(port: 0);
        // A real raw receiver standing in for the headset.
        final receiver = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
        addTearDown(receiver.close);

        final service = RealTqrcgService(
          pairingSession: pairingSession,
          lanSocket: sendingSocket,
          pollInterval: const Duration(seconds: 5),
        );
        addTearDown(service.cancel);

        final received = Completer<String>();
        receiver.listen((event) {
          if (event != RawSocketEvent.read) return;
          final datagram = receiver.receive();
          if (datagram != null && !received.isCompleted) {
            received.complete(utf8.decode(datagram.data));
          }
        });

        // sendingSocket itself must be "open" for send() to do anything —
        // see LanDiscoverySocket.send's own doc.
        await sendingSocket.open();
        addTearDown(sendingSocket.close);

        final context = HeadsetPairingContext(
          enrolmentHandle: 'the-handle',
          headsetEndpoint: HeadsetLanEndpoint(host: '127.0.0.1', port: receiver.port),
        );

        service.issue(deviceId: 'quest3', deviceName: 'Meta Quest 3', pairingContext: context).listen((_) {});

        final raw = await received.future.timeout(const Duration(seconds: 5));
        final decoded = PairingContextCodec.decode(raw);
        expect(decoded, isNotNull);
        expect(decoded!.pairingSessionId, 'sess-1');
      });
    });

    test('a null headsetEndpoint still reaches showing — sending is best-effort only', () async {
      final h = _harness();
      addTearDown(h.service.cancel);

      final events = await h.service
          .issue(
            deviceId: 'quest3',
            deviceName: 'Meta Quest 3',
            pairingContext: const HeadsetPairingContext(enrolmentHandle: 'the-handle'),
          )
          .take(2)
          .toList();

      expect(events.last.phase, PairingPhase.showing);
    });
  });
}
