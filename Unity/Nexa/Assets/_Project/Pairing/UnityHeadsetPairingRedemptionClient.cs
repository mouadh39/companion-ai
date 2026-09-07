using System;
using System.Collections;
using System.Text;
using Nexa.Core.Pairing;
using Nexa.Data.Backend;
using UnityEngine;
using UnityEngine.Networking;

namespace Nexa.Pairing
{
    /// <summary>
    /// <see cref="IHeadsetPairingRedemptionClient"/> over a real HTTP POST — the same
    /// <see cref="UnityWebRequest"/>-plus-coroutine shape <c>Nexa.Net.HttpCompanionBackend</c>
    /// already established for the companion's own HTTP call, reused here rather than invented
    /// again: a <see cref="MonoBehaviour"/> for the coroutine host, a <c>[Serializable]</c> request
    /// payload built with <see cref="JsonUtility"/>, and every actual interpretation decision
    /// delegated to <see cref="PairingRedemptionResponseInterpreter"/> rather than made inline here
    /// — which is what makes that logic testable in EditMode while this shell, like every other
    /// Unity file in this codebase, is not compiled or executed in this environment (no matching
    /// Unity Editor is available — see the report).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Sends exactly two fields — <c>code</c> and <c>signatureBase64</c>, wired as <c>{code,
    /// signature}</c> on the wire — matching <c>RedeemPairingSessionBody</c> in
    /// <c>apps/backend/src/server.ts</c> exactly. Nothing else is ever added to this request: no
    /// private key, no password, no Supabase token, no refresh token, no device metadata the
    /// backend's own route does not ask for.
    /// </para>
    /// <para>
    /// Makes exactly one attempt per <see cref="Redeem"/> call — see
    /// <see cref="IHeadsetPairingRedemptionClient"/>'s own doc on why this class never retries on
    /// its own initiative, including on a timeout.
    /// </para>
    /// </remarks>
    [DisallowMultipleComponent]
    public sealed class UnityHeadsetPairingRedemptionClient : MonoBehaviour, IHeadsetPairingRedemptionClient
    {
        [Header("Configuration")]
        [SerializeField] DevicePairingBackendConfig _config;

        const string ContentTypeHeader = "Content-Type";
        const string JsonContentType = "application/json";

        [Serializable]
        sealed class RedeemRequestPayload
        {
            public string code;
            public string signature;
        }

        public void Redeem(string code, string signatureBase64, Action<PairingRedemptionOutcome> onResult)
        {
            if (onResult == null) throw new ArgumentNullException(nameof(onResult));
            if (string.IsNullOrEmpty(code)) throw new ArgumentException("A pairing code is required.", nameof(code));
            if (string.IsNullOrEmpty(signatureBase64))
                throw new ArgumentException("A signature is required.", nameof(signatureBase64));

            if (_config == null || !_config.IsComplete)
            {
                // Reported as an outcome, matching HttpCompanionBackend.Send's own precedent for an
                // unconfigured backend — an unreachable configuration is unreachable in exactly the
                // way a stopped server is.
                onResult(PairingRedemptionOutcome.Unreachable("No usable backend configuration."));
                return;
            }

            StartCoroutine(RunRedeem(code, signatureBase64, onResult));
        }

        IEnumerator RunRedeem(string code, string signatureBase64, Action<PairingRedemptionOutcome> onResult)
        {
            string body = JsonUtility.ToJson(new RedeemRequestPayload { code = code, signature = signatureBase64 });

            PairingRedemptionOutcome outcome;
            using (UnityWebRequest request = new UnityWebRequest(_config.RedeemUrl, UnityWebRequest.kHttpVerbPOST))
            {
                request.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader(ContentTypeHeader, JsonContentType);
                request.timeout = _config.TimeoutSeconds;

                yield return request.SendWebRequest();

                outcome = Interpret(request);
            }

            onResult(outcome);
        }

        static PairingRedemptionOutcome Interpret(UnityWebRequest request)
        {
            switch (request.result)
            {
                case UnityWebRequest.Result.ConnectionError:
                    return PairingRedemptionResponseInterpreter.InterpretConnectionError(request.error);

                case UnityWebRequest.Result.DataProcessingError:
                    return PairingRedemptionResponseInterpreter.InterpretDataProcessingError(request.error);

                case UnityWebRequest.Result.ProtocolError:
                    return PairingRedemptionResponseInterpreter.InterpretFailureStatus(
                        request.responseCode, request.downloadHandler.text);

                default:
                    return PairingRedemptionResponseInterpreter.InterpretSuccessStatus(request.downloadHandler.text);
            }
        }
    }
}
