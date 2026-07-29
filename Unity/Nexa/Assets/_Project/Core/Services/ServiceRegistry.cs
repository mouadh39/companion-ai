using System;
using System.Collections.Generic;

namespace Nexa.Core.Services
{
    /// <summary>
    /// Typed registry of application-scoped services, populated once by the composition root.
    /// </summary>
    /// <remarks>
    /// <para>
    /// This is a service locator, and a service locator is a weaker pattern than real dependency
    /// injection: it hides a type's dependencies from its constructor. The constraint that makes it
    /// acceptable here is a rule enforced by assembly boundaries — <b>only the composition root
    /// (<c>Nexa.App</c>) resolves from this registry</b>. Everything downstream, including the whole
    /// companion, receives its dependencies through explicit <c>Initialize(...)</c> parameters and
    /// never references this type. So the dependency graph stays visible and unit-testable, while
    /// avoiding a container dependency this early.
    /// </para>
    /// <para>
    /// When the graph outgrows roughly fifteen services, replace this with VContainer. Because
    /// consumers already take their dependencies as parameters, that migration only rewrites the
    /// composition root.
    /// </para>
    /// </remarks>
    public sealed class ServiceRegistry
    {
        readonly Dictionary<Type, object> _services = new Dictionary<Type, object>();

        /// <summary>
        /// Registers <paramref name="service"/> as the implementation of <typeparamref name="TService"/>.
        /// </summary>
        /// <exception cref="ArgumentNullException">If <paramref name="service"/> is null.</exception>
        /// <exception cref="InvalidOperationException">If <typeparamref name="TService"/> is already registered.</exception>
        public void Register<TService>(TService service) where TService : class
        {
            if (service == null)
                throw new ArgumentNullException(nameof(service));

            Type key = typeof(TService);
            if (_services.ContainsKey(key))
            {
                throw new InvalidOperationException(
                    $"A service is already registered for '{key.Name}'. Registering twice almost " +
                    "always means two composition roots are running — check for a duplicated bootstrap.");
            }

            _services.Add(key, service);
        }

        public bool TryResolve<TService>(out TService service) where TService : class
        {
            if (_services.TryGetValue(typeof(TService), out object stored))
            {
                service = (TService)stored;
                return true;
            }

            service = null;
            return false;
        }

        /// <summary>Resolves a required service, failing loudly rather than returning null.</summary>
        /// <exception cref="InvalidOperationException">If the service was never registered.</exception>
        public TService Resolve<TService>() where TService : class
        {
            if (TryResolve(out TService service))
                return service;

            throw new InvalidOperationException(
                $"No service registered for '{typeof(TService).Name}'. It must be registered by the " +
                "composition root before any consumer initialises.");
        }

        public bool IsRegistered<TService>() where TService : class => _services.ContainsKey(typeof(TService));

        /// <summary>
        /// Drops every registration. Called on application teardown so that entering play mode with
        /// domain reload disabled cannot leak services from the previous run.
        /// </summary>
        public void Clear() => _services.Clear();
    }
}
