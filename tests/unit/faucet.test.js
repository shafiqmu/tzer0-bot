const { ethers } = require('ethers');
const { checkBalance } = require('../../src/actions/faucet');

describe('faucet', () => {
  it('returns current balance', async () => {
    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
    const signer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae243d3733a0fe8c', provider);
    const bal = await checkBalance(signer);
    expect(bal).toBeGreaterThanOrEqual(0n);
  });
});
