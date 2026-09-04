import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/auth_session.dart';

void main() {
  AuthSession session({Duration fromNow = const Duration(hours: 1)}) =>
      AuthSession(
        accessToken: 'the-access-token',
        refreshToken: 'the-refresh-token',
        expiresAt: DateTime.now().add(fromNow),
        userId: 'user-1',
      );

  test('round-trips through toJson/fromJson', () {
    final original = session();
    final restored = AuthSession.fromJson(original.toJson());

    expect(restored.accessToken, original.accessToken);
    expect(restored.refreshToken, original.refreshToken);
    expect(restored.userId, original.userId);
    expect(restored.expiresAt, original.expiresAt);
  });

  test('toJson carries exactly the four expected fields — no more', () {
    expect(
      session().toJson().keys.toSet(),
      {'accessToken', 'refreshToken', 'expiresAt', 'userId'},
    );
  });

  group('isExpired', () {
    test('is false well before expiry', () {
      expect(session(fromNow: const Duration(hours: 1)).isExpired(), isFalse);
    });

    test('is true once past expiry', () {
      expect(
        session(fromNow: const Duration(seconds: -1)).isExpired(),
        isTrue,
      );
    });

    test('is true inside the default skew window, even if not literally expired yet', () {
      expect(
        session(fromNow: const Duration(seconds: 10)).isExpired(),
        isTrue,
      );
    });

    test('a caller can narrow or widen the skew window', () {
      final s = session(fromNow: const Duration(seconds: 10));
      expect(s.isExpired(skew: Duration.zero), isFalse);
      expect(s.isExpired(skew: const Duration(minutes: 1)), isTrue);
    });
  });

  test('toString never contains either token', () {
    final s = session();
    final text = s.toString();

    expect(text, isNot(contains('the-access-token')));
    expect(text, isNot(contains('the-refresh-token')));
    expect(text, contains('redacted'));
    // What it is safe to show stays visible.
    expect(text, contains('user-1'));
  });
}
