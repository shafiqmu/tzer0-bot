const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  bgYellow: (text) => `\x1b[43m\x1b[30m${text}\x1b[0m`,
  bgGreen: (text) => `\x1b[42m\x1b[30m${text}\x1b[0m`,
  bgRed: (text) => `\x1b[41m\x1b[37m${text}\x1b[0m`,
};

function shortenHash(hash) {
  if (!hash || hash === '0x') return '0x';
  if (hash.length <= 16) return hash;
  return hash.slice(0, 6) + '...' + hash.slice(-4);
}

function formatResult(action, result) {
  if (!result) return '';
  
  // Transaction receipt
  if (result && result.hash && result.status !== undefined) {
    const statusIcon = result.status === 1 ? '✅' : '❌';
    return `${statusIcon} tx: ${shortenHash(result.hash)} | block: ${result.blockNumber} | gas: ${result.gasUsed}`;
  }
  
  // Pending rewards
  if (result && result.pending !== undefined) {
    return `💰 pending: ${result.pending} wei`;
  }
  
  // Balance check
  if (typeof result === 'string' && /^\d+$/.test(result)) {
    const eth = Number(result) / 1e18;
    return `💎 ${eth.toFixed(6)} ETH`;
  }
  
  // Mission address
  if (result && result.missionAddress) {
    return `🎯 mission: ${shortenHash(result.missionAddress)}`;
  }
  
  // Generic
  return '';
}

function shortenError(error) {
  if (!error) return 'Unknown error';
  
  // Extract main error message
  const match = error.match(/"message":\s*"([^"]+)"/);
  if (match) return match[1];
  
  // Fallback to first line
  const firstLine = error.split('\n')[0];
  if (firstLine.length > 100) {
    return firstLine.slice(0, 97) + '...';
  }
  return firstLine;
}

function printAction(index, total, action, result, success, error) {
  const actionLabel = typeof action === 'string' ? action : Object.keys(action)[0];
  const actionData = typeof action === 'string' ? {} : action[actionLabel];
  
  // Progress line
  const progress = colors.cyan(`[${index}/${total}]`);
  const label = colors.bold(actionLabel.toUpperCase());
  console.log(`\n${progress} ${label}`);
  
  if (actionData && typeof actionData === 'object' && Object.keys(actionData).length > 0) {
    for (const [key, value] of Object.entries(actionData)) {
      console.log(`   ${key}: ${value}`);
    }
  }
  
  if (error) {
    const shortError = shortenError(error);
    console.log(`   ${colors.red('❌ Error:')} ${shortError}`);
  } else if (result) {
    const formatted = formatResult(action, result);
    if (formatted) {
      console.log(`   ${colors.green(formatted)}`);
    } else {
      console.log(`   ${colors.green('✅ Success')}`);
    }
  }
}

function printWallet(wallet, index, total) {
  const shortAddr = shortenHash(wallet);
  const header = ` WALLET ${index + 1}/${total} `;
  
  console.log('\n' + '═'.repeat(70));
  console.log(colors.bgYellow(header));
  console.log(colors.bold(`   ${shortAddr}`));
  console.log('═'.repeat(70));
}

function printSummary(results) {
  const total = results.reduce((sum, r) => {
    if (Array.isArray(r.results)) return sum + r.results.length;
    return sum + 1;
  }, 0);
  
  let passed = 0;
  let failed = 0;
  
  if (Array.isArray(results)) {
    for (const r of results) {
      if (Array.isArray(r.results)) {
        for (const action of r.results) {
          if (action.success) passed++;
          else if (action.error) failed++;
          else passed++;
        }
      } else if (r.error) {
        failed++;
      } else {
        passed++;
      }
    }
  }
  
  const statusIcon = failed === 0 ? colors.green('✅') : colors.red('❌');
  
  console.log(`\n${colors.yellow('═'.repeat(70))}`);
  console.log(`${colors.bold('📊 FINAL SUMMARY')} ${statusIcon}`);
  console.log(`${colors.yellow('═'.repeat(70))}`);
  console.log(`   Total actions : ${total}`);
  console.log(`${colors.green('   Passed       : ')}${passed}`);
  if (failed > 0) {
    console.log(`${colors.red('   Failed       : ')}${failed}`);
  }
  console.log(`${colors.yellow('═'.repeat(70))}`);
}

module.exports = {
  printAction,
  printWallet,
  printSummary,
  shortenHash,
};
