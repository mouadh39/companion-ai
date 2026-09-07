import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/data/models/phone_device.dart';
import 'package:nexa_client/data/repositories/phone_device_store.dart';
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

void main() {
  test('read() before anything is written returns null', () async {
    final store = PhoneDeviceStore(_FakeKeyValueStore());
    expect(await store.read(), isNull);
  });

  test('a written device record round-trips through read()', () async {
    final store = PhoneDeviceStore(_FakeKeyValueStore());
    const original = LocalPhoneDevice(userId: 'user-1', phoneDeviceId: 'dev-1');

    await store.write(original);
    final restored = await store.read();

    expect(restored, isNotNull);
    expect(restored!.userId, 'user-1');
    expect(restored.phoneDeviceId, 'dev-1');
  });

  test('clear() removes what was written', () async {
    final store = PhoneDeviceStore(_FakeKeyValueStore());
    await store.write(const LocalPhoneDevice(userId: 'u', phoneDeviceId: 'd'));

    await store.clear();

    expect(await store.read(), isNull);
  });

  test('uses a different key from SessionStore, so the two can never collide', () async {
    final kv = _FakeKeyValueStore();
    await PhoneDeviceStore(kv).write(const LocalPhoneDevice(userId: 'u', phoneDeviceId: 'd'));

    expect(kv.values.keys, isNot(contains('nexa.auth.session.v1')));
  });

  group('malformed stored device state is treated as no device, not a crash', () {
    test('a value that is not JSON at all', () async {
      final kv = _FakeKeyValueStore()..values['nexa.device.phone.v1'] = 'not json';
      expect(await PhoneDeviceStore(kv).read(), isNull);
    });

    test('valid JSON missing a field this needs', () async {
      final kv = _FakeKeyValueStore()..values['nexa.device.phone.v1'] = '{"userId":"u"}';
      expect(await PhoneDeviceStore(kv).read(), isNull);
    });

    test('a JSON array instead of an object', () async {
      final kv = _FakeKeyValueStore()..values['nexa.device.phone.v1'] = '[1,2]';
      expect(await PhoneDeviceStore(kv).read(), isNull);
    });
  });
}
