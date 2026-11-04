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
node src/index.js run tasks/contoh.yaml     # auto single/multi
node src/index.js dryrun tasks/contoh.yaml  # simpan tanpa tx
node src/index.js stake <name> [ticker]     # launch mission
```

`run` otomatis detek mode:
- 1 wallet → single mode
- banyak wallet (`PRIVATE_KEYS_JSON`) → multi mode, tampil `Wallet X/Y`

## Task YAML

```yaml
name: e2e-test
actions:
  - balance: check
  - buy:
      mission: "0x15522727F10Ea666Ebb4fD4c23B394580F10FED4"
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

| Env | Fungsi |
|-----|--------|
| `RPC_URL` | Base Sepolia RPC |
| `PRIVATE_KEY` | single wallet |
| `PRIVATE_KEYS_JSON` | multi wallet array JSON |
| `TEST_WALLET_FILE` | path ke test wallet JSON |
| `CHAIN_ID` | default `84532` |

Precedence wallet: `PRIVATE_KEY` → `PRIVATE_KEYS_JSON` → `TEST_WALLET_FILE`

## Output

```
════════════════════════════════════════════════════════════
 WALLET 1/2
   0x8fd3...7A03
════════════════════════════════════════════════════════════

🚀 Starting task: testnet-smoke
👛 Wallet: 0x8fd379246834eac74B8419FfdA202CF8051F7A03

[1/3] BALANCE
   ✅ Success

[2/3] BUY
   mission: 0x86E0...19979
   amount: 0.00001
   ❌ Error: insufficient funds for gas * price + value

[3/3] SELL
   mission: 0x86E0...19979
   amount: 106215
   ❌ Error: insufficient funds for gas * price + value

════════════════════════════════════════════════════════════
📊 FINAL SUMMARY ❌
════════════════════════════════════════════════════════════
   Total actions : 3
   Passed       : 1
   Failed       : 2
════════════════════════════════════════════════════════════
```

## Live Tested

- Buy $T0 via router `0xb4cf5a53`
- Sell $T0 via router
- Stake/unstake/claim
- Launch mission
- Multi-wallet runner
- Retry logic
- Console-only output, no file logging
