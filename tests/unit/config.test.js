const { loadConfig } = require('../../src/config');

describe('config', () => {
  it('loads env and returns rpc + wallet', () => {
    process.env.RPC_URL = 'https://sepolia.base.org';
    process.env.PRIVATE_KEY = '0xabc';
    const cfg = loadConfig();
    expect(cfg.rpcUrl).toBe('https://sepolia.base.org');
    expect(cfg.privateKey).toBe('0xabc');
  });
});
