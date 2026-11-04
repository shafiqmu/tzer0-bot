const { ethers } = require('ethers');
const fs = require('fs');
const { createSigner } = require('./signer');

function loadTestWalletKey(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  if (!data.privateKey) throw new Error(`Test wallet file missing privateKey: ${filePath}`);
  return data.privateKey;
}

function getActiveWallet(cfg, index = 0) {
  let keys = [];
  if (cfg.privateKey) {
    keys = [cfg.privateKey];
  } else if (cfg.privateKeysJson) {
    keys = Object.values(JSON.parse(cfg.privateKeysJson));
  } else if (cfg.testWalletFile) {
    keys = [loadTestWalletKey(cfg.testWalletFile)];
  } else if (Array.isArray(cfg.privateKeys)) {
    keys = cfg.privateKeys;
  }

  if (!keys.length) {
    throw new Error('No private key configured. Set PRIVATE_KEY, PRIVATE_KEYS_JSON, or TEST_WALLET_FILE.');
  }

  const key = keys[index % keys.length];
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  return createSigner(key, provider);
}

function getAllSigners(cfg) {
  let keys = [];
  if (cfg.privateKey) {
    keys = [cfg.privateKey];
  } else if (cfg.privateKeysJson) {
    keys = Object.values(JSON.parse(cfg.privateKeysJson));
  } else if (cfg.testWalletFile) {
    keys = [loadTestWalletKey(cfg.testWalletFile)];
  } else if (Array.isArray(cfg.privateKeys)) {
    keys = cfg.privateKeys;
  }

  if (!keys.length) {
    throw new Error('No private keys configured.');
  }

  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  return keys.map(key => createSigner(key, provider));
}

function rotateWallet(cfg, currentIndex = 0) {
  return getActiveWallet(cfg, currentIndex + 1);
}

module.exports = { getActiveWallet, getAllSigners, rotateWallet };
