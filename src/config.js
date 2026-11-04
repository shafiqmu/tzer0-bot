require('dotenv').config();
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Bare wallet line in .env: 64-char hex private key, optional 0x prefix.
const BARE_KEY_LINE = /^(0x)?[0-9a-fA-F]{64}$/;

function extractBareKeys(text) {
  const keys = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.includes('=')) continue;
    if (BARE_KEY_LINE.test(line)) {
      keys.push(line.startsWith('0x') ? line : `0x${line}`);
    }
  }
  return keys;
}

function findEnvFile() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadBareKeysFromEnvFile(envPath = findEnvFile()) {
  if (!envPath) return [];
  try {
    return extractBareKeys(fs.readFileSync(envPath, 'utf8'));
  } catch {
    return [];
  }
}

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

function loadPrivateKeysFromEnv(envPath) {
  // Primary format: bare `0x...` lines in .env, one key per line (top to bottom).
  const fileKeys = loadBareKeysFromEnvFile(envPath);
  if (fileKeys.length) return fileKeys;

  // Legacy: PRIVATE_KEY_1, PRIVATE_KEY_2, ...
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

  // Legacy: PRIVATE_KEYS_JSON
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

function loadTask(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  loadConfig,
  loadTask,
  extractBareKeys,
  loadBareKeysFromEnvFile,
  loadPrivateKeysFromEnv,
};
