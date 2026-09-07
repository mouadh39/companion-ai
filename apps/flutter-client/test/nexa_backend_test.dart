import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/models/pairing_api.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';
import 'package:nexa_client/data/repositories/nexa_backend.dart';

/// Builds a [NexaBackend] whose one HTTP call is intercepted by [handler],
/// and hands back the request the backend method actually sent so a test
/// can assert on its shape.
({NexaBackend backend, Future<http.Request> Function() lastRequest}) _harness(
  Future<http.Response> Function(http.Request) handler,
) {
  http.Request? seen;
  final client = NexaApiClient(
    baseUrl: Uri.parse('https://nexa.example/'),
    httpClient: MockClient((request) async {
      seen = request;
      return handler(request);
    }),
  );
  return (
    backend: NexaBackend(client),
    lastRequest: () async => seen!,
  );
}

http.Response _ok(Map<String, dynamic> body, [int status = 200]) =>
    http.Response(jsonEncode(body), status);

void main() {
  group('registerDevice', () {
    test('POSTs to /v1/devices with the bearer token and decodes the device', () async {
      final h = _harness(
        (r) async => _ok({
          'deviceId': 'dev-1',
          'kind': 'phone',
          'label': 'My phone',
          'registeredAt': '2026-09-03T12:00:00.000Z',
        }, 201),
      );

      final device = await h.backend.registerDevice(
        bearerToken: 'phone-supabase-token',
        label: 'My phone',
      );

      final request = await h.lastRequest();
      expect(request.url.path, '/v1/devices');
      expect(request.headers['authorization'], 'Bearer phone-supabase-token');
      expect(jsonDecode(request.body), {'label': 'My phone'});

      expect(device.deviceId, 'dev-1');
      expect(device.kind, 'phone');
      expect(device.label, 'My phone');
      expect(device.registeredAt, DateTime.parse('2026-09-03T12:00:00.000Z'));
    });

    test('omits label from the body when none is given', () async {
      final h = _harness(
        (r) async => _ok({
          'deviceId': 'dev-1',
          'kind': 'phone',
          'label': null,
          'registeredAt': '2026-09-03T12:00:00.000Z',
        }, 201),
      );

      await h.backend.registerDevice(bearerToken: 't');

      final request = await h.lastRequest();
      expect((jsonDecode(request.body) as Map).containsKey('label'), isFalse);
    });
  });

  group('createDeviceEnrolment', () {
    test('POSTs to /v1/device-enrolments with no Authorization header', () async {
      final h = _harness(
        (r) async => _ok({
          'enrolmentId': 'enr-1',
          'handle': 'the-handle',
          'expiresAt': '2026-09-03T12:05:00.000Z',
        }, 201),
      );

      final enrolment = await h.backend.createDeviceEnrolment(
        publicKeyBase64: 'base64-spki-der',
        keySecurityLevel: 'tee',
      );

      final request = await h.lastRequest();
      expect(request.url.path, '/v1/device-enrolments');
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(jsonDecode(request.body), {
        'publicKey': 'base64-spki-der',
        'keySecurityLevel': 'tee',
      });

      expect(enrolment.enrolmentId, 'enr-1');
      expect(enrolment.handle, 'the-handle');
    });
  });

  group('createPairingSession', () {
    test('POSTs to /v1/pairing-sessions with the bearer token', () async {
      final h = _harness(
        (r) async => _ok({
          'pairingSessionId': 'sess-1',
          'code': 'NX2.abc123',
          'expiresAt': '2026-09-03T12:02:00.000Z',
        }, 201),
      );

      final session = await h.backend.createPairingSession(
        bearerToken: 'phone-token',
        phoneDeviceId: 'dev-1',
        enrolmentHandle: 'the-handle',
      );

      final request = await h.lastRequest();
      expect(request.headers['authorization'], 'Bearer phone-token');
      expect(jsonDecode(request.body), {
        'phoneDeviceId': 'dev-1',
        'enrolmentHandle': 'the-handle',
      });

      expect(session.pairingSessionId, 'sess-1');
      expect(session.code, 'NX2.abc123');
    });
  });

  group('getPairingSessionStatus', () {
    test('GETs /v1/pairing-sessions/:id/status with the bearer token', () async {
      final h = _harness((r) async => _ok({'status': 'pending', 'deviceId': null}));

      final status = await h.backend.getPairingSessionStatus(
        bearerToken: 'phone-token',
        pairingSessionId: 'sess-1',
      );

      final request = await h.lastRequest();
      expect(request.method, 'GET');
      expect(request.url.path, '/v1/pairing-sessions/sess-1/status');
      expect(request.headers['authorization'], 'Bearer phone-token');

      expect(status.status, PairingSessionStatusValue.pending);
      expect(status.deviceId, isNull);
    });

    test('a redeemed status carries the headset device id', () async {
      final h = _harness((r) async => _ok({'status': 'redeemed', 'deviceId': 'headset-1'}));

      final status = await h.backend.getPairingSessionStatus(
        bearerToken: 'phone-token',
        pairingSessionId: 'sess-1',
      );

      expect(status.status, PairingSessionStatusValue.redeemed);
      expect(status.deviceId, 'headset-1');
    });

    test('expired and cancelled both parse to their own distinct values', () async {
      final expiredHarness = _harness((r) async => _ok({'status': 'expired', 'deviceId': null}));
      expect(
        (await expiredHarness.backend.getPairingSessionStatus(bearerToken: 't', pairingSessionId: 's')).status,
        PairingSessionStatusValue.expired,
      );

      final cancelledHarness = _harness((r) async => _ok({'status': 'cancelled', 'deviceId': null}));
      expect(
        (await cancelledHarness.backend.getPairingSessionStatus(bearerToken: 't', pairingSessionId: 's')).status,
        PairingSessionStatusValue.cancelled,
      );
    });

    test('an unrecognised status value is treated as pending, never as paired', () async {
      final h = _harness((r) async => _ok({'status': 'some_future_value', 'deviceId': null}));

      final status = await h.backend.getPairingSessionStatus(bearerToken: 't', pairingSessionId: 's');

      expect(status.status, PairingSessionStatusValue.pending);
    });

    test('a session id is percent-encoded into the path', () async {
      final h = _harness((r) async => _ok({'status': 'pending', 'deviceId': null}));

      await h.backend.getPairingSessionStatus(bearerToken: 't', pairingSessionId: 'a b/c');

      final request = await h.lastRequest();
      expect(request.url.path, contains('a%20b%2Fc'));
    });

    test('a 404 (not mine, or does not exist) raises NexaApiException', () async {
      final h = _harness((r) async => _ok({'error': 'not_found', 'message': 'nope'}, 404));

      await expectLater(
        h.backend.getPairingSessionStatus(bearerToken: 't', pairingSessionId: 's'),
        throwsA(isA<NexaApiException>()),
      );
    });
  });

  group('redeemPairingSession', () {
    test('POSTs to /v1/pairing-sessions/redeem with no Authorization header', () async {
      final h = _harness(
        (r) async => _ok({
          'paired': true,
          'deviceId': 'headset-1',
          'accessToken': 'the-access-token',
          'refreshToken': 'the-refresh-token',
          'expiresIn': 3600,
        }),
      );

      final result = await h.backend.redeemPairingSession(
        code: 'NX2.abc123',
        signature: 'base64-der-signature',
      );

      final request = await h.lastRequest();
      expect(request.url.path, '/v1/pairing-sessions/redeem');
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(jsonDecode(request.body), {
        'code': 'NX2.abc123',
        'signature': 'base64-der-signature',
      });

      expect(result.deviceId, 'headset-1');
      expect(result.credentials.accessToken, 'the-access-token');
      expect(result.credentials.refreshToken, 'the-refresh-token');
      expect(result.credentials.expiresIn, 3600);
    });

    test('a refusal (e.g. an invalid code) raises NexaApiException, not a null result', () async {
      final h = _harness((r) async => _ok({'error': 'invalid_request', 'message': 'nope'}, 400));

      await expectLater(
        h.backend.redeemPairingSession(code: 'NX2.bad', signature: 'sig'),
        throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.invalidRequest)),
      );
    });
  });

  group('refreshDeviceToken', () {
    test('POSTs to /v1/devices/token/refresh with no Authorization header, and the '
        "response's own new refresh token comes back under the field name the "
        "backend actually sends: refreshToken, not newRefreshToken", () async {
      final h = _harness(
        (r) async => _ok({
          'accessToken': 'rotated-access-token',
          'refreshToken': 'rotated-refresh-token',
          'expiresIn': 1209600,
        }),
      );

      final credentials = await h.backend.refreshDeviceToken(
        refreshToken: 'still-live-refresh-token',
        signature: 'base64-der-signature',
      );

      final request = await h.lastRequest();
      expect(request.url.path, '/v1/devices/token/refresh');
      expect(request.headers.containsKey('authorization'), isFalse);
      expect(jsonDecode(request.body), {
        'refreshToken': 'still-live-refresh-token',
        'signature': 'base64-der-signature',
      });

      expect(credentials.accessToken, 'rotated-access-token');
      expect(credentials.refreshToken, 'rotated-refresh-token');
    });
  });
}
