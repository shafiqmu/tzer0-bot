const { ethers } = require('ethers');

function createSigner(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider);
}

module.exports = { createSigner };
