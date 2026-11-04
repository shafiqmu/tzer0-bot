const { getAllSigners } = require('../wallet/manager');
const { executeTask } = require('./task');
const { printWallet, printSummary } = require('./display');

async function runForAllWallets(cfg, task) {
  const signers = getAllSigners(cfg);
  const results = [];

  for (let i = 0; i < signers.length; i++) {
    printWallet(signers[i].address, i, signers.length);
    const walletResults = await executeTask(cfg, task, signers[i]);
    results.push({
      wallet: signers[i].address,
      results: walletResults,
    });
  }

  return results;
}

module.exports = { runForAllWallets };
