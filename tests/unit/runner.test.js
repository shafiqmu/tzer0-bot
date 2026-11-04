const { dryRun } = require('../../src/runner/dryrun');
const { loadConfig } = require('../../src/config');

describe('runner', () => {
  it('dry-run reports actions without signing', async () => {
    process.env.RPC_URL = 'https://sepolia.base.org';
    process.env.PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae243d3733a0fe8c';
    const cfg = loadConfig();
    const task = { actions: [{ balance: 'check' }] };
    const result = await dryRun(cfg, task);
    expect(result[0].action).toEqual({ balance: 'check' });
    expect(result[0].status).toBe('simulated');
  });
});
