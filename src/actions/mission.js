const { ethers } = require('ethers');
const { getContracts } = require('../contracts/client');

/**
 * buyMission — beli token mission langsung dari curve launchpad (fase PRE-LIFT).
 * INI yang ngasih crew pts (+150 per mission, tiket ≥0.001 ETH, tahan sampe lift).
 * Beda dari fuel.js `buy` yang cuma swap ETH->$T0 via router.
 */
async function buyMission(signer, missionAddress, ethAmount, opts = {}) {
  const contracts = getContracts(signer);
  const value = ethers.parseEther(String(ethAmount));
  const minTokens = opts.minTokens != null ? opts.minTokens : 0;

  let gasLimit;
  try {
    const est = await contracts.launchpad.buy.estimateGas(missionAddress, minTokens, { value });
    gasLimit = (est * 13n) / 10n;
    if (gasLimit < 200000n) gasLimit = 200000n;
  } catch (e) {
    gasLimit = 900000n; // fallback
  }

  const tx = await contracts.launchpad.buy(missionAddress, minTokens, { value, gasLimit });
  const receipt = await tx.wait();
  return { txHash: receipt.hash, gasUsed: (receipt.gasUsed || 0n).toString() };
}

/**
 * sellMission — jual token mission (dipakai nanti di fase jual post-lift).
 * tokenAmount: kalau string -> dianggap unit token (18 desimal); kalau bigint -> pakai langsung.
 */
async function sellMission(signer, missionAddress, tokenAmount, opts = {}) {
  const contracts = getContracts(signer);
  const amount = typeof tokenAmount === 'string' ? ethers.parseUnits(tokenAmount, 18) : tokenAmount;
  const tx = await contracts.launchpad.sell(missionAddress, amount, opts.minNative || 0);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

module.exports = { buyMission, sellMission };
