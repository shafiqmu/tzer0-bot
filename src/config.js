require('dotenv').config();
const yaml = require('js-yaml');
const fs = require('fs');

function parsePrivateKeys(raw) {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean);
}

function loadPrivateKeysFromEnv() {
  const keys = Object.keys(process.env)
    .filter((k) => k.startsWith('PRIVATE_KEY_'))
    .sort((a, b) => {
      const na = Number(a.split('_').pop());
      const nb = Number(b.split('_').pop());
      return (na || 0) - (nb || 0);
    })
    .map((k) => process.env[k].trim())
    .filter(Boolean);

  if (keys.length) return keys;

  const raw = process.env.PRIVATE_KEYS_JSON;
  if (raw) return parsePrivateKeys(raw);

  return [];
}

function loadConfig() {
  return {
    rpcUrl: process.env.RPC_URL,
    privateKey: process.env.PRIVATE_KEY,
    privateKeys: loadPrivateKeysFromEnv(),
    testWalletFile: process.env.TEST_WALLET_FILE || '',
    chainId: Number(process.env.CHAIN_ID || 84532),
  };
}

function loadTask(path) {
  return yaml.load(fs.readFileSync(path, 'utf8'));
}

module.exports = { loadConfig, loadTask };
