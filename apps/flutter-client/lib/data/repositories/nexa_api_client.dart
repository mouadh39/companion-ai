import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/api_failure.dart';

/// The one place an HTTP request to the Nexa backend is made, and the one
/// place a failure of any kind becomes a [NexaApiException].
///
/// Every endpoint-specific repository is written against this rather than
/// against `package:http` directly, for the same reason the rest of this
/// app is written against an interface and not an implementation: a test
/// substitutes [httpClient] with a fake and never touches a socket, and a
/// change to how requests are made — a new header, a different timeout —
/// happens once, here, rather than once per call site.
///
/// This class knows nothing about pairing, devices, or tokens. It knows how
/// to send a JSON POST and turn whatever comes back — a decoded body, a
/// timeout, a dropped connection, a non-2xx status — into exactly one of
/// two things: a `Map<String, dynamic>` or a [NexaApiException]. What the
/// map means is the caller's job.
class NexaApiClient {
  NexaApiClient({
    required this.baseUrl,
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 15),
  }) : _http = httpClient ?? http.Client();

  /// Where the Nexa backend is. Required rather than defaulted — guessing an
  /// environment here is exactly the kind of decision this layer should not
  /// make silently.
  final Uri baseUrl;

  final Duration timeout;
  final http.Client _http;

  /// Sends a JSON POST to `baseUrl` + [path].
  ///
  /// [body] is JSON-encoded as-is; the caller decides what it contains and
  /// this method never inspects it beyond encoding it. [bearerToken], when
  /// given, becomes the request's `Authorization` header — never logged,
  /// never echoed into any exception this throws.
  ///
  /// Returns the decoded JSON body on any 2xx response. Every other outcome
  /// — a network failure, a timeout, a non-2xx status, a body that is not
  /// the JSON object a caller can use — raises [NexaApiException] with a
  /// [NexaApiFailureKind] a caller can switch on, and a message safe to show
  /// or log as-is.
  ///
  /// [extraHeaders], when given, are added alongside the two this method
  /// always sets — for a header a specific backend needs that no other
  /// caller does (Supabase's GoTrue wants `apikey` on every call; the Nexa
  /// backend wants nothing beyond a bearer token). This method still knows
  /// nothing about what either value means or where it came from.
  Future<Map<String, dynamic>> postJson(
    String path, {
    Map<String, dynamic>? body,
    String? bearerToken,
    Map<String, String>? extraHeaders,
  }) async {
    final uri = baseUrl.resolve(path);
    final headers = <String, String>{
      'content-type': 'application/json',
      'accept': 'application/json',
      if (bearerToken != null) 'authorization': 'Bearer $bearerToken',
      if (extraHeaders != null) ...extraHeaders,
    };
    final encoded = body == null ? '' : jsonEncode(body);

    late final http.Response response;
    try {
      response = await _http
          .post(uri, headers: headers, body: encoded)
          .timeout(timeout);
    } on TimeoutException {
      throw const NexaApiException(
        NexaApiFailureKind.timeout,
        'Nexa took too long to respond.',
      );
    } on http.ClientException {
      // Covers a dropped connection, DNS failure, refused connection and
      // the like — `package:http` wraps the platform-specific exception in
      // its own type, so this one catch is the whole surface.
      throw const NexaApiException(
        NexaApiFailureKind.network,
        "Couldn't reach Nexa. Check your connection.",
      );
    }

    return _decode(response);
  }

  /// Sends a JSON GET to `baseUrl` + [path].
  ///
  /// Same contract as [postJson] in every way that overlaps — [bearerToken]
  /// becomes the `Authorization` header, the same [NexaApiException] kinds
  /// come back for the same failures, decoded through the same [_decode] —
  /// except there is no request body to send, because a GET carries none.
  Future<Map<String, dynamic>> getJson(
    String path, {
    String? bearerToken,
    Map<String, String>? extraHeaders,
  }) async {
    final uri = baseUrl.resolve(path);
    final headers = <String, String>{
      'accept': 'application/json',
      if (bearerToken != null) 'authorization': 'Bearer $bearerToken',
      if (extraHeaders != null) ...extraHeaders,
    };

    late final http.Response response;
    try {
      response = await _http.get(uri, headers: headers).timeout(timeout);
    } on TimeoutException {
      throw const NexaApiException(
        NexaApiFailureKind.timeout,
        'Nexa took too long to respond.',
      );
    } on http.ClientException {
      throw const NexaApiException(
        NexaApiFailureKind.network,
        "Couldn't reach Nexa. Check your connection.",
      );
    }

    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    final status = response.statusCode;

    if (status >= 200 && status < 300) {
      if (response.body.isEmpty) return const {};
      final Object? decoded;
      try {
        decoded = jsonDecode(response.body);
      } on FormatException {
        throw NexaApiException(
          NexaApiFailureKind.decodeFailed,
          'Nexa sent a response this app could not read.',
          statusCode: status,
        );
      }
      if (decoded is Map<String, dynamic>) return decoded;
      throw NexaApiException(
        NexaApiFailureKind.decodeFailed,
        'Nexa sent a response this app did not expect.',
        statusCode: status,
      );
    }

    // The backend's own error bodies (`{error, message}`) are deliberately
    // never read here. Its own design collapses many distinct failures into
    // one generic message on purpose — repeating that text back would be
    // harmless, but branching this client's behaviour on it would couple it
    // to wording the backend is free to change, when the status code alone
    // already carries everything a caller here can act on.
    final kind = switch (status) {
      400 => NexaApiFailureKind.invalidRequest,
      401 => NexaApiFailureKind.unauthorized,
      403 => NexaApiFailureKind.forbidden,
      429 => NexaApiFailureKind.rateLimited,
      >= 500 => NexaApiFailureKind.server,
      _ => NexaApiFailureKind.unknown,
    };
    throw NexaApiException(kind, _messageFor(kind), statusCode: status);
  }

  static String _messageFor(NexaApiFailureKind kind) => switch (kind) {
    NexaApiFailureKind.invalidRequest => 'That request could not be used.',
    NexaApiFailureKind.unauthorized => 'Please sign in again.',
    NexaApiFailureKind.forbidden => 'That is not available on this account.',
    NexaApiFailureKind.rateLimited => 'Too many attempts. Try again shortly.',
    NexaApiFailureKind.server => "Nexa couldn't complete that just now.",
    NexaApiFailureKind.network ||
    NexaApiFailureKind.timeout ||
    NexaApiFailureKind.decodeFailed ||
    NexaApiFailureKind.unknown => "Something went wrong on Nexa's side.",
  };

  /// Releases the underlying HTTP client's resources. Only meaningful when
  /// this instance owns one — a caller that supplied its own [httpClient]
  /// owns its lifecycle and should close it itself.
  void close() => _http.close();
}
