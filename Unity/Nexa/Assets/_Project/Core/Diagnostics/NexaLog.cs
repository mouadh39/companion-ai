using System.Diagnostics;
using UnityEngine;

namespace Nexa.Core.Diagnostics
{
    /// <summary>
    /// Logging facade whose informational calls compile out of release player builds.
    /// </summary>
    /// <remarks>
    /// <see cref="ConditionalAttribute"/> removes the call *and the evaluation of its arguments* at
    /// the call site when the symbol is undefined. That matters on mobile: interpolated log strings
    /// inside per-frame AR code allocate every frame and drive GC spikes that read as stutter in a
    /// head-mounted display. Warnings and errors always survive, because a shipping build that
    /// cannot report failure is not debuggable.
    /// </remarks>
    public static class NexaLog
    {
        const string EditorSymbol = "UNITY_EDITOR";
        const string VerboseSymbol = "NEXA_VERBOSE_LOGGING";

        [Conditional(EditorSymbol), Conditional(VerboseSymbol)]
        public static void Info(string tag, string message) => UnityEngine.Debug.Log(Format(tag, message));

        [Conditional(EditorSymbol), Conditional(VerboseSymbol)]
        public static void Info(string tag, string message, Object context) =>
            UnityEngine.Debug.Log(Format(tag, message), context);

        public static void Warn(string tag, string message) => UnityEngine.Debug.LogWarning(Format(tag, message));

        public static void Warn(string tag, string message, Object context) =>
            UnityEngine.Debug.LogWarning(Format(tag, message), context);

        public static void Error(string tag, string message) => UnityEngine.Debug.LogError(Format(tag, message));

        public static void Error(string tag, string message, Object context) =>
            UnityEngine.Debug.LogError(Format(tag, message), context);

        static string Format(string tag, string message) => $"[{tag}] {message}";
    }
}
