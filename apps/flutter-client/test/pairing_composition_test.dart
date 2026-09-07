import 'package:flutter_test/flutter_test.dart';
import 'package:nexa_client/app_state.dart';
import 'package:nexa_client/data/repositories/device_link_service.dart';
import 'package:nexa_client/data/repositories/local_transport_link.dart';
import 'package:nexa_client/data/repositories/real_tqrcg_service.dart';
import 'package:nexa_client/data/repositories/tqrcg_service.dart';

/// The one guarantee that matters for device pairing: a production build —
/// one that injected nothing — composes the *real* transport, never the
/// scripted UI stand-ins. `LocalTransportPairingLink` reports `connected`
/// only on a real decoded advertisement from the requested headset;
/// `RealTqrcgService` reports `paired` only when the backend confirms a
/// verified redemption. `LocalTqrcgService` / `LocalDeviceLinkService` walk
/// those phases on a timer with nothing behind them, and must only ever
/// appear when a test asks for them by name.
void main() {
  test('the default (production) composition is the real pairing transport', () {
    final state = NexaAppState();
    addTearDown(state.dispose);

    expect(state.tqrcgService, isA<RealTqrcgService>());
    expect(state.deviceLinkService, isA<LocalTransportPairingLink>());

    expect(state.tqrcgService, isNot(isA<LocalTqrcgService>()));
    expect(state.deviceLinkService, isNot(isA<LocalDeviceLinkService>()));
  });

  test('a QA-hook build (skipEntrance) still gets the real transport', () {
    final state = NexaAppState(skipEntrance: true);
    addTearDown(state.dispose);

    expect(state.tqrcgService, isA<RealTqrcgService>());
    expect(state.deviceLinkService, isA<LocalTransportPairingLink>());
  });

  test('the scripted stand-ins appear only when a test injects them', () {
    final state = NexaAppState(
      tqrcg: LocalTqrcgService(),
      link: LocalDeviceLinkService(),
    );
    addTearDown(state.dispose);

    expect(state.tqrcgService, isA<LocalTqrcgService>());
    expect(state.deviceLinkService, isA<LocalDeviceLinkService>());
  });
}
