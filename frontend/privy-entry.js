import PrivyClient, { LocalStorage } from '@privy-io/js-sdk-core';

const APP_ID = 'cmqms7kcv008r0dl7xfsjtxrq';

let client = null;

function cleanOldPrivyKeys() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('privy:')) continue;
      const val = localStorage.getItem(key);
      try { JSON.parse(val); } catch { localStorage.removeItem(key); }
    }
  } catch (_) {}
}

async function getClient() {
  if (client) return client;
  cleanOldPrivyKeys();
  client = new PrivyClient({
    appId: APP_ID,
    storage: new LocalStorage(),
  });
  await client.initialize();
  return client;
}

window.PrivySDK = {
  /* Initialize and return current user (or null) */
  init: async function () {
    const c = await getClient();
    try { return await c.user.get(); } catch (_) { return null; }
  },

  /* Connect MetaMask → SIWE → Privy session */
  connectMetaMask: async function () {
    if (!window.ethereum) throw new Error('MetaMask not found');
    const c = await getClient();

    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const address  = accounts[0];
    const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const chainId  = `eip155:${parseInt(chainHex, 16)}`;

    const { message } = await c.auth.siwe.init(
      { address, chainId },
      window.location.hostname,
      window.location.href,
    );

    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    });

    const { user } = await c.auth.siwe.loginWithSiwe(signature);
    return user;
  },

  sendEmailCode: async function (email) {
    const c = await getClient();
    await c.auth.email.sendCode(email);
  },

  loginWithEmailCode: async function (email, code) {
    const c = await getClient();
    const { user } = await c.auth.email.loginWithCode(email, code);
    return user;
  },

  logout: async function () {
    const c = await getClient();
    const u = await c.user.get().catch(() => null);
    await c.auth.logout(u || undefined);
  },

  getUser: async function () {
    const c = await getClient();
    try { return await c.user.get(); } catch (_) { return null; }
  },
};
