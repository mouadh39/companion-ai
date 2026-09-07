/// What this installation remembers about its own phone device row on the
/// backend: the server-issued id, and which account it was registered
/// under.
///
/// [userId] is never sent to the backend and never trusted as an identity
/// claim by anything — `POST /v1/devices` derives the account entirely from
/// the bearer token, exactly as every authenticated route does. It exists
/// here purely as a local integrity tag: the one thing a device id alone
/// cannot answer is "was this registered for whoever is signed in right
/// now, or for someone who used to be." See `PhoneDeviceRepository.restore`.
class LocalPhoneDevice {
  const LocalPhoneDevice({required this.userId, required this.phoneDeviceId});

  factory LocalPhoneDevice.fromJson(Map<String, dynamic> json) =>
      LocalPhoneDevice(
        userId: json['userId'] as String,
        phoneDeviceId: json['phoneDeviceId'] as String,
      );

  final String userId;

  /// Not a secret — see `PhoneDeviceRepository`'s module doc. Handled
  /// carefully here anyway only because it shares storage with
  /// [AuthSession], not because this value itself needs the protection.
  final String phoneDeviceId;

  Map<String, dynamic> toJson() => {
    'userId': userId,
    'phoneDeviceId': phoneDeviceId,
  };
}
