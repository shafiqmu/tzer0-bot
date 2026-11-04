const { ethers } = require('ethers');
const { getContracts, ADDRS } = require('../contracts/client');

async function buy(signer, missionAddress, ethAmount) {
  const router = new ethers.Contract(ADDRS.router, [], signer);
  const value = ethers.parseEther(ethAmount);
  const deadline = Math.floor(Date.now() / 1000 + 60 * 20);
  const token = ADDRS.t0.replace('0x', '').padStart(64, '0');
  const amount = '0x' + value.toString(16).padStart(64, '0');
  const recipient = signer.address.replace('0x', '').padStart(64, '0');
  const deadlineHex = '0x' + deadline.toString(16).padStart(64, '0');
  const data = '0xb4cf5a53' + token + amount.slice(2) + recipient + deadlineHex.slice(2);

  const tx = await signer.sendTransaction({
    to: ADDRS.router,
    data,
    value,
    gasLimit: 300000,
  });
  return await tx.wait();
}

async function sell(signer, missionAddress, tokenAmount) {
  const token = new ethers.Contract(ADDRS.t0, [
    'function approve(address,uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
  ], signer);

  const amount = ethers.parseUnits(tokenAmount, 18);
  const allowance = await token.allowance(signer.address, ADDRS.router);
  if (allowance < amount) {
    const tx = await token.approve(ADDRS.router, amount);
    await tx.wait();
  }

  const router = new ethers.Contract(ADDRS.router, [], signer);
  const deadline = Math.floor(Date.now() / 1000 + 60 * 20);
  const tokenHex = ADDRS.t0.replace('0x', '').padStart(64, '0');
  const amountHex = '0x' + amount.toString(16).padStart(64, '0');
  const recipient = signer.address.replace('0x', '').padStart(64, '0');
  const deadlineHex = '0x' + deadline.toString(16).padStart(64, '0');
  const data = '0xb4cf5a53' + tokenHex + amountHex.slice(2) + recipient + deadlineHex.slice(2);

  const tx = await signer.sendTransaction({
    to: ADDRS.router,
    data,
    gasLimit: 300000,
  });
  return await tx.wait();
}

module.exports = { buy, sell };
