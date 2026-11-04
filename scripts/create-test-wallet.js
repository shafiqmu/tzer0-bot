const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

function createTestWallet(label = 'tzer0-bot-test') {
  const wallet = ethers.Wallet.createRandom();
  const outDir = path.join(__dirname, '..', 'test-wallets');
  fs.mkdirSync(outDir, { recursive: true });
  const fileName = label.endsWith('.json') ? label : `${label}.json`;
  const filePath = path.join(outDir, fileName);
  const payload = {
    label,
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic.phrase,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  fs.chmodSync(filePath, 0o600);
  return payload;
}

const label = process.argv[2] || 'tzer0-bot-test';
const wallet = createTestWallet(label);
console.log('Wallet created:', wallet.address);
console.log('Saved to', `test-wallets/${label}.json`);
