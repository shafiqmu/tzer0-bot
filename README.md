# TZer0 Automation Bot

On-chain automation for Base Sepolia TZer0 testnet.

## Termux Setup

```bash
# 1. Install Termux dari F-Droid (bukan Play Store)
# 2. Buka Termux, kasih permission storage:
termux-setup-storage

# 3. Clone atau copy bot ini ke phone
# 4. Run setup:
bash termux-setup.sh

# 5. Edit .env dengan private key atau test wallet
nano .env

# 6. Jalankan bot:
node src/index.js run tasks/e2e-t0.yaml

# 7. Enable wake lock agar ga mati:
termux-wake-lock
```

## Commands

```bash
node src/index.js run tasks/e2e-t0.yaml    # single wallet
node src/index.js multi tasks/e2e-t0.yaml  # multi wallet
node src/index.js dryrun tasks/e2e-t0.yaml # simpan tanpa tx
node src/index.js stake <name> [ticker]    # launch mission
```

## Task YAML

```yaml
name: e2e-test
actions:
  - balance: check
  - buy:
      mission: "0x15522727F10Ea666Ebb4fD4c23b394580F10FED4"
      amount: "0.0001"
  - rewards: check
  - stake:
      amount: "1"
  - unstake:
      amount: "1"
  - claim
  - rewards: check
```

## Config

- `RPC_URL` — Base Sepolia RPC
- `PRIVATE_KEY` — single wallet
- `PRIVATE_KEYS_JSON` — multi wallet array
- `TEST_WALLET_FILE` — path ke test wallet JSON
- `CHAIN_ID` — default 84532

## Output

```
🚀 Starting task: t0-e2e-test
👛 Wallet: 0xf368...

[1/8] FAUCET
   💎 0.010042 ETH

[2/8] BUY
   mission: 0x1552...
   amount: 0.001
   ✅ tx: 0x65ca... | block: 54314890 | gas: 214728

[3/8] REWARDS
   💰 pending: 0 wei

...

════════════════════════════════════════════════════════════
📊 Summary
════════════════════════════════════════════════════════════
Total actions: 8
Passed: 8
Failed: 0
════════════════════════════════════════════════════════════

Log saved to: logs/t0-e2e-test-1793787403817.json
```

## Live Tested

- Buy $T0 via router `0xb4cf5a53`
- Sell $T0 via router
- Stake/unstake/claim
- Launch mission
- Multi-wallet runner
- Retry + logging
