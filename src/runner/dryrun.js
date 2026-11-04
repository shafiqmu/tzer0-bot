const { printAction } = require('./display');

async function dryRun(cfg, task) {
  const { getActiveWallet } = require('../wallet/manager');
  const signer = getActiveWallet(cfg);
  const results = [];
  
  console.log(`\n🔍 Dry run: ${task.name || 'untitled'}`);
  console.log(`👛 Wallet: ${signer.address}\n`);
  
  for (let i = 0; i < task.actions.length; i++) {
    const action = task.actions[i];
    const actionLabel = Object.keys(action)[0];
    
    // Simulate result based on action type
    let simulatedResult = null;
    if (actionLabel === 'balance') {
      simulatedResult = '0';
    } else if (actionLabel === 'rewards') {
      simulatedResult = { pending: '0' };
    } else if (actionLabel === 'launch') {
      simulatedResult = { missionAddress: '0x...' };
    } else if (['buy', 'sell', 'stake', 'unstake', 'claim'].includes(actionLabel)) {
      simulatedResult = { hash: '0x...', status: 1, blockNumber: 0, gasUsed: '0' };
    }
    
    results.push({ action, status: 'simulated', detail: action });
    printAction(i + 1, task.actions.length, action, simulatedResult, true, null);
  }
  
  return results;
}

module.exports = { dryRun };
