const { ethers } = require('ethers');

describe('fuel', () => {
  it('parses eth amount to wei', () => {
    expect(ethers.parseEther('0.1').toString()).toBe('100000000000000000');
  });
});
