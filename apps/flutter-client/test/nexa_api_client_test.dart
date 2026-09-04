import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nexa_client/data/models/api_failure.dart';
import 'package:nexa_client/data/repositories/nexa_api_client.dart';

void main() {
  final baseUrl = Uri.parse('https://nexa.example/');

  test('a successful response decodes the body as JSON', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        return http.Response(jsonEncode({'ok': true, 'n': 3}), 200);
      }),
    );

    final body = await client.postJson('/v1/thing');

    expect(body, {'ok': true, 'n': 3});
  });

  test('an empty 200 body decodes as an empty map', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async => http.Response('', 200)),
    );

    expect(await client.postJson('/v1/thing'), <String, dynamic>{});
  });

  test('the request carries the JSON body given to it, and nothing else', () async {
    http.Request? seen;
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response('{}', 200);
      }),
    );

    await client.postJson('/v1/thing', body: {'a': 1, 'b': 'two'});

    expect(seen, isNotNull);
    expect(jsonDecode(seen!.body), {'a': 1, 'b': 'two'});
    expect(seen!.headers['content-type'], contains('application/json'));
  });

  test('a bearer token becomes the Authorization header', () async {
    http.Request? seen;
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response('{}', 200);
      }),
    );

    await client.postJson('/v1/thing', bearerToken: 'the-real-token');

    expect(seen!.headers['authorization'], 'Bearer the-real-token');
  });

  test('no bearer token means no Authorization header at all', () async {
    http.Request? seen;
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response('{}', 200);
      }),
    );

    await client.postJson('/v1/thing');

    expect(seen!.headers.containsKey('authorization'), isFalse);
  });

  test('the request reaches baseUrl resolved against the given path', () async {
    Uri? seenUrl;
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        seenUrl = request.url;
        return http.Response('{}', 200);
      }),
    );

    await client.postJson('/v1/pairing-sessions');

    expect(seenUrl, Uri.parse('https://nexa.example/v1/pairing-sessions'));
  });

  group('status codes map to the right failure kind', () {
    final cases = <int, NexaApiFailureKind>{
      400: NexaApiFailureKind.invalidRequest,
      401: NexaApiFailureKind.unauthorized,
      403: NexaApiFailureKind.forbidden,
      429: NexaApiFailureKind.rateLimited,
      500: NexaApiFailureKind.server,
      503: NexaApiFailureKind.server,
      418: NexaApiFailureKind.unknown,
    };

    for (final entry in cases.entries) {
      test('${entry.key} -> ${entry.value.name}', () async {
        final client = NexaApiClient(
          baseUrl: baseUrl,
          httpClient: MockClient(
            (request) async => http.Response(
              jsonEncode({'error': 'whatever', 'message': 'internal detail'}),
              entry.key,
            ),
          ),
        );

        await expectLater(
          client.postJson('/v1/thing'),
          throwsA(
            isA<NexaApiException>()
                .having((e) => e.kind, 'kind', entry.value)
                .having((e) => e.statusCode, 'statusCode', entry.key),
          ),
        );
      });
    }
  });

  test('an error response never leaks the backend body into the exception', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient(
        (request) async => http.Response(
          jsonEncode({
            'error': 'invalid_request',
            'message': 'super secret internal detail nobody should see',
          }),
          400,
        ),
      ),
    );

    try {
      await client.postJson('/v1/thing');
      fail('expected a NexaApiException');
    } on NexaApiException catch (e) {
      expect(e.message, isNot(contains('super secret internal detail')));
      expect(e.toString(), isNot(contains('super secret internal detail')));
    }
  });

  test('a non-JSON body raises decodeFailed', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async => http.Response('not json', 200)),
    );

    await expectLater(
      client.postJson('/v1/thing'),
      throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.decodeFailed)),
    );
  });

  test('a JSON array instead of an object raises decodeFailed', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async => http.Response('[1,2,3]', 200)),
    );

    await expectLater(
      client.postJson('/v1/thing'),
      throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.decodeFailed)),
    );
  });

  test('a dropped connection raises network', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      httpClient: MockClient((request) async {
        throw http.ClientException('Connection refused');
      }),
    );

    await expectLater(
      client.postJson('/v1/thing'),
      throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.network)),
    );
  });

  test('a response slower than the timeout raises timeout', () async {
    final client = NexaApiClient(
      baseUrl: baseUrl,
      timeout: const Duration(milliseconds: 20),
      httpClient: MockClient((request) async {
        await Future<void>.delayed(const Duration(milliseconds: 200));
        return http.Response('{}', 200);
      }),
    );

    await expectLater(
      client.postJson('/v1/thing'),
      throwsA(isA<NexaApiException>().having((e) => e.kind, 'kind', NexaApiFailureKind.timeout)),
    );
  });

  group('getJson', () {
    test('sends a real GET, not a POST', () async {
      http.Request? seen;
      final client = NexaApiClient(
        baseUrl: baseUrl,
        httpClient: MockClient((request) async {
          seen = request;
          return http.Response(jsonEncode({'ok': true}), 200);
        }),
      );

      final body = await client.getJson('/v1/thing');

      expect(seen!.method, 'GET');
      expect(body, {'ok': true});
    });

    test('sends no request body', () async {
      http.Request? seen;
      final client = NexaApiClient(
        baseUrl: baseUrl,
        httpClient: MockClient((request) async {
          seen = request;
          return http.Response('{}', 200);
        }),
      );

      await client.getJson('/v1/thing');

      expect(seen!.body, isEmpty);
    });

    test('a bearer token becomes the Authorization header, same as postJson', () async {
      http.Request? seen;
      final client = NexaApiClient(
        baseUrl: baseUrl,
        httpClient: MockClient((request) async {
          seen = request;
          return http.Response('{}', 200);
        }),
      );

      await client.getJson('/v1/thing', bearerToken: 'a-token');

      expect(seen!.headers['authorization'], 'Bearer a-token');
    });

    test('a non-2xx response raises NexaApiException, same mapping as postJson', () async {
      final client = NexaApiClient(
        baseUrl: baseUrl,
        httpClient: MockClient((request) async => http.Response('{}', 404)),
      );

      await expectLater(
        client.getJson('/v1/thing'),
        throwsA(isA<NexaApiException>()),
      );
    });
  });
}
