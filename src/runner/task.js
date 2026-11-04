const { getActiveWallet } = require('../wallet/manager');
const { checkBalance } = require('../actions/faucet');
const { createMission, resolveLaunch } = require('../actions/launch');
const { buy, sell } = require('../actions/fuel');
const { stake, unstake, claim, pendingRewards } = require('../actions/stake');
const { printAction } = require('./display');

function normalizeAction(action) {
  if (typeof action === 'string') {
    return { [action]: true };
  }
  return action;
}

async function executeAction(signer, action, retries = 2) {
  const normalized = normalizeAction(action);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (normalized.balance) return await checkBalance(signer);
      if (normalized.launch) {
        const resolved = resolveLaunch(normalized.launch);
        normalized.launch = resolved;
        return await createMission(signer, resolved);
      }
      if (normalized.buy) return await buy(signer, normalized.buy.mission, normalized.buy.amount);
      if (normalized.sell) return await sell(signer, normalized.sell.mission, normalized.sell.amount);
      if (normalized.stake) return await stake(signer, normalized.stake.amount);
      if (normalized.unstake) return await unstake(signer, normalized.unstake.amount);
      if (normalized.claim) return await claim(signer);
      if (normalized.rewards) {
        const r = await pendingRewards(signer);
        return { pending: r.toString() };
      }
      throw new Error(`Unknown action: ${JSON.stringify(normalized)}`);
    } catch (err) {
      if (attempt < retries) {
        console.log(`⏳ Retrying ${Object.keys(normalized)[0]} (${attempt + 1}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function executeTask(cfg, task, signerOverride = null) {
  const signer = signerOverride || getActiveWallet(cfg);
  const results = [];
  
  console.log(`\n🚀 Starting task: ${task.name || 'untitled'}`);
  console.log(`👛 Wallet: ${signer.address}`);
  
  for (let i = 0; i < task.actions.length; i++) {
    const action = task.actions[i];
    try {
      const result = await executeAction(signer, action);
      results.push({ action, result, success: true });
      printAction(i + 1, task.actions.length, action, result, true, null);
    } catch (err) {
      results.push({ action, error: err.message, success: false });
      printAction(i + 1, task.actions.length, action, null, false, err.message);
    }
  }
  
  return results;
}

module.exports = { executeTask };
