const { ethers } = require('ethers');
const { createSigner } = require('../../src/wallet/signer');

describe('wallet', () => {
  it('creates signer from private key', () => {
    const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
    const signer = createSigner('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae243d3733a0fe8c', provider);
    expect(signer.address).toBe('0x75075F472e5e3Da4a82a8c19880AF87DB70B4263');
  });
});
