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

function loadConfig() {
  return {
    rpcUrl: process.env.RPC_URL,
    privateKey: process.env.PRIVATE_KEY,
    privateKeys: parsePrivateKeys(process.env.PRIVATE_KEYS_JSON),
    testWalletFile: process.env.TEST_WALLET_FILE || '',
    chainId: Number(process.env.CHAIN_ID || 84532),
  };
}

function loadTask(path) {
  return yaml.load(fs.readFileSync(path, 'utf8'));
}

module.exports = { loadConfig, loadTask };
