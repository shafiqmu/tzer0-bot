const { ethers } = require('ethers');
const { getContracts, ADDRS } = require('../contracts/client');

async function ensureApproval(signer, amount) {
  const token = new ethers.Contract(
    ADDRS.t0,
    ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256)'],
    signer
  );
  const allowance = await token.allowance(signer.address, ADDRS.staking);
  if (allowance < amount) {
    const tx = await token.approve(ADDRS.staking, ethers.MaxUint256);
    await tx.wait();
  }
}

async function stake(signer, tokenAmount) {
  const contracts = getContracts(signer);
  const amount = ethers.parseUnits(tokenAmount, 18);
  await ensureApproval(signer, amount);
  const tx = await contracts.staking.stake(amount);
  return await tx.wait();
}

async function unstake(signer, tokenAmount) {
  const contracts = getContracts(signer);
  const amount = ethers.parseUnits(tokenAmount, 18);
  const tx = await contracts.staking.unstake(amount);
  return await tx.wait();
}

async function claim(signer) {
  const contracts = getContracts(signer);
  const tx = await contracts.staking.claim();
  return await tx.wait();
}

async function pendingRewards(signer) {
  const contracts = getContracts(signer);
  const r = await contracts.staking.pending(signer.address);
  return BigInt(r);
}

function expectedPendingRewardsBehavior() {
  return 'returns uint256 rewards for address';
}

module.exports = { stake, unstake, claim, pendingRewards, expectedPendingRewardsBehavior };
