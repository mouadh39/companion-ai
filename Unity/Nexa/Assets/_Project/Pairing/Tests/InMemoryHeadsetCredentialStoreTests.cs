using System;
using Nexa.Core.Pairing;
using NUnit.Framework;

namespace Nexa.Pairing.Tests
{
    [TestFixture]
    public class InMemoryHeadsetCredentialStoreTests
    {
        static DeviceCredentials Sample() =>
            new DeviceCredentials("device-1", "access-1", "refresh-1", 1000);

        [Test]
        public void HasCredentialsIsFalseBeforeAnySave()
        {
            var store = new InMemoryHeadsetCredentialStore();
            Assert.IsFalse(store.HasCredentials);
        }

        [Test]
        public void SaveThenLoadRoundTripsExactly()
        {
            var store = new InMemoryHeadsetCredentialStore();
            store.Save(Sample());

            Assert.IsTrue(store.HasCredentials);
            DeviceCredentials loaded = store.Load();
            Assert.AreEqual("device-1", loaded.DeviceId);
            Assert.AreEqual("access-1", loaded.AccessToken);
            Assert.AreEqual("refresh-1", loaded.RefreshToken);
            Assert.AreEqual(1000, loaded.ExpiresInSeconds);
        }

        [Test]
        public void LoadWithNothingStoredThrows()
        {
            var store = new InMemoryHeadsetCredentialStore();
            Assert.Throws<InvalidOperationException>(() => store.Load());
        }

        [Test]
        public void ASecondSaveReplacesTheFirst()
        {
            var store = new InMemoryHeadsetCredentialStore();
            store.Save(Sample());
            store.Save(new DeviceCredentials("device-2", "access-2", "refresh-2", 2000));

            Assert.AreEqual("device-2", store.Load().DeviceId);
        }

        [Test]
        public void ClearRemovesWhatWasStored()
        {
            var store = new InMemoryHeadsetCredentialStore();
            store.Save(Sample());
            store.Clear();

            Assert.IsFalse(store.HasCredentials);
            Assert.Throws<InvalidOperationException>(() => store.Load());
        }

        [Test]
        public void ClearWithNothingStoredIsSafe()
        {
            var store = new InMemoryHeadsetCredentialStore();
            Assert.DoesNotThrow(() => store.Clear());
        }

        [Test]
        public void CredentialsToStringNeverIncludesEitherToken()
        {
            string text = Sample().ToString();
            StringAssert.DoesNotContain("access-1", text);
            StringAssert.DoesNotContain("refresh-1", text);
        }
    }
}
