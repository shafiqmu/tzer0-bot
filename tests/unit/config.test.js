const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadConfig,
  extractBareKeys,
  loadBareKeysFromEnvFile,
  loadPrivateKeysFromEnv,
} = require('../../src/config');

const KEY_1 = '0x' + 'a1'.repeat(32);
const KEY_2 = '0x' + 'b2'.repeat(32);
const KEY_LEGACY = '0x' + 'c3'.repeat(32);

describe('config', () => {
  afterEach(() => {
    delete process.env.PRIVATE_KEY_1;
  });

  it('loads env and returns rpc + wallet', () => {
    process.env.RPC_URL = 'https://sepolia.base.org';
    process.env.PRIVATE_KEY = '0xabc';
    const cfg = loadConfig();
    expect(cfg.rpcUrl).toBe('https://sepolia.base.org');
    expect(cfg.privateKey).toBe('0xabc');
  });

  describe('bare private key lines in .env', () => {
    it('extracts keys one per line, in order', () => {
      const text = `RPC_URL=https://sepolia.base.org\nCHAIN_ID=84532\n\n# wallet 1\n${KEY_1}\n${KEY_2}\n`;
      expect(extractBareKeys(text)).toEqual([KEY_1, KEY_2]);
    });

    it('ignores comments, KEY=VALUE lines, short hex and junk', () => {
      const text = [
        '# comment',
        'RPC_URL=https://sepolia.base.org',
        'PRIVATE_KEY_1=' + KEY_1,
        '0x1234',
        'not a key',
        KEY_1,
      ].join('\n');
      expect(extractBareKeys(text)).toEqual([KEY_1]);
    });

    it('normalizes a key without 0x prefix', () => {
      expect(extractBareKeys(KEY_1.slice(2))).toEqual([KEY_1]);
    });

    it('reads keys from an .env file', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzer0-'));
      const envPath = path.join(dir, '.env');
      fs.writeFileSync(envPath, `${KEY_1}\n${KEY_2}\n`);
      try {
        expect(loadBareKeysFromEnvFile(envPath)).toEqual([KEY_1, KEY_2]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns [] for a missing env file', () => {
      expect(loadBareKeysFromEnvFile('/no/such/.env')).toEqual([]);
    });

    it('wins over legacy PRIVATE_KEY_* when both exist', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzer0-'));
      const envPath = path.join(dir, '.env');
      fs.writeFileSync(envPath, `${KEY_1}\n${KEY_2}\n`);
      process.env.PRIVATE_KEY_1 = KEY_LEGACY;
      try {
        expect(loadPrivateKeysFromEnv(envPath)).toEqual([KEY_1, KEY_2]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to legacy PRIVATE_KEY_* when no bare keys', () => {
      process.env.PRIVATE_KEY_1 = KEY_LEGACY;
      expect(loadPrivateKeysFromEnv('/no/such/.env')).toEqual([KEY_LEGACY]);
    });
  });
});
