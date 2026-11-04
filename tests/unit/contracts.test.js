const { ethers } = require('ethers');
const { getContracts } = require('../../src/contracts/client');

describe('contracts', () => {
  it('returns contract instances for known addresses', () => {
    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
    const signer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae243d3733a0fe8c', provider);
    const contracts = getContracts(signer);
    expect(contracts.launchpad.target).toBe('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c');
  });
});
