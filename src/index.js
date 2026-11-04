const { loadConfig, loadTask } = require('./config');
const { executeTask } = require('./runner/task');
const { runForAllWallets } = require('./runner/multi');
const { dryRun } = require('./runner/dryrun');
const { printSummary } = require('./runner/display');

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if ((cmd === 'run' || cmd === 'multi') && args[1]) {
    const cfg = loadConfig();
    const task = loadTask(args[1]);
    const { getAllSigners } = require('./wallet/manager');
    const signers = getAllSigners(cfg);

    if (signers.length > 1) {
      const results = await runForAllWallets(cfg, task);
      printSummary(results);
    } else {
      const results = await executeTask(cfg, task);
      printSummary(results);
    }
  } else if (cmd === 'dryrun' && args[1]) {
    const cfg = loadConfig();
    const task = loadTask(args[1]);
    await dryRun(cfg, task);
  } else {
    console.log('Usage: node src/index.js <run|dryrun> <task.yaml>');
    console.log('  run     - auto single/multi based on env');
    console.log('  dryrun  - simulate without sending');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
