using System;
using Nexa.Core.Pairing;

namespace Nexa.Pairing
{
    /// <summary>
    /// The integration seam for a real, camera-backed <see cref="IHeadsetQrScanner"/> — and
    /// exactly that, nothing more. Every member throws.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This class exists so the rest of the codebase (a future composition root) has a concrete
    /// type to name once real camera acquisition is implemented, without that implementation
    /// needing to exist yet — the same reason <c>AndroidHeadsetIdentity</c>'s non-Android branch
    /// throws instead of the type simply not existing. It must never be mistaken for a working
    /// scanner: every member throws <see cref="NotImplementedException"/> immediately, loudly,
    /// rather than silently reporting <see cref="QrScanOutcome.NotFound"/> forever or fabricating
    /// a result.
    /// </para>
    /// <para>
    /// ## Why real camera acquisition is not implemented in this step
    /// </para>
    /// <para>
    /// This repository's Unity package manifest
    /// (<c>Unity/Nexa/Packages/manifest.json</c>) declares
    /// <c>com.unity.xr.androidxr-openxr</c> and <c>com.unity.xr.meta-openxr</c> — generic
    /// Android XR / Meta OpenXR feature layers — and nothing from Meta's dedicated camera SDK.
    /// Real research (not assumption) into what camera access is actually available under this
    /// stack found two documented paths, neither of which this codebase can verify without
    /// physical Quest 3/3S hardware:
    /// </para>
    /// <para>
    /// 1. Unity's own built-in <c>WebCamTexture</c> API — the same class used for phone/tablet/PC
    ///    webcam access — reportedly also reaches Quest 3/3S's passthrough camera, requiring only
    ///    the standard <c>android.permission.CAMERA</c> manifest permission (this project
    ///    currently declares no custom <c>AndroidManifest.xml</c> at all — see 3F-F's report).
    ///    Meta's own documentation notes it "only supports one camera at a time," which is fine
    ///    for QR scanning.
    /// </para>
    /// <para>
    /// 2. Meta's dedicated Passthrough Camera API (a separate SDK from what this project
    ///    currently references), gated to Quest 3/3S only, using the
    ///    <c>horizonos.permission.HEADSET_CAMERA</c> permission for passthrough-only access.
    ///    Publicly shippable to the Horizon Store since April 2025.
    /// </para>
    /// <para>
    /// Either path is a genuinely new integration this codebase has never attempted, on hardware
    /// this project has no way to test against. A frame decoded via either path still needs an
    /// actual QR-decoding algorithm run over it — this codebase has none vendored (see the
    /// report's decoder-candidate discussion) — so a real implementation replacing this class
    /// needs both a camera source and a decoder wired together, neither of which exists here yet.
    /// </para>
    /// </remarks>
    public sealed class UnverifiedCameraQrScanner : IHeadsetQrScanner
    {
        const string Message =
            "UnverifiedCameraQrScanner is an integration seam, not a working scanner — see its " +
            "own class doc. Real camera acquisition (WebCamTexture or Meta's Passthrough Camera " +
            "API) and a real QR decoder must both be implemented and verified on physical Quest " +
            "hardware before this type is usable.";

        public bool IsScanning => false;

        public void StartScanning(Action<QrScanResult> onResult) => throw new NotImplementedException(Message);

        public void StopScanning() => throw new NotImplementedException(Message);
    }
}
