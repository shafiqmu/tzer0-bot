# TZer0 Automation Bot

On-chain automation for Base Sepolia TZer0 testnet.

> 📌 **Farming Ops — baca [`docs/OPS-NOTES.md`](docs/OPS-NOTES.md) dulu** sebelum ngoprek.
> Isinya: arsitektur mesin (factory-line/mission/consolidate/mini-lap), aturan poin,
> pitfalls mahal (funding mentok, exclude basi, sweep), resep wind-down, dan status akhir operasi.

## Termux Setup

```bash
# 1. Install Termux dari F-Droid (bukan Play Store)
# 2. Buka Termux, kasih permission storage:
termux-setup-storage

# 3. Clone atau copy bot ini ke phone
# 4. Run setup:
bash termux-setup.sh

# 5. Edit .env — tempel private key langsung (satu per baris)
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
```

`run` otomatis detek mode:
- 1 wallet → single mode
- banyak wallet (beberapa baris `0x...` di `.env`) → multi mode, tampil `Wallet X/Y`

## Launch Mission

Buat file YAML misal `tasks/launch.yaml`:

```yaml
name: launch
actions:
  - launch:
      name: "random"
      ticker: "random"
      initialBuyEth: "0"
```

`name` dan `ticker` bisa diisi `"random"` atau dikosongkan untuk auto-generate:
- `name` → kombinasi human-like seperti `NexusAI`, `Alpha Capital`, `Daedalus`
- `ticker` → 3 huruf acak

Jalankan:
```bash
node src/index.js run tasks/launch.yaml
```

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

Contoh `.env`:

```env
RPC_URL=https://sepolia.base.org
CHAIN_ID=84532

0x1111...aaaa   # wallet 1
0x2222...bbbb   # wallet 2  ← tambah baris = tambah wallet
```

| Env | Fungsi |
|-----|--------|
| `RPC_URL` | Base Sepolia RPC |
| `0x...` (baris polos) | wallet — satu private key per baris, langsung tempel |
| `CHAIN_ID` | default `84532` |

Precedence wallet: `PRIVATE_KEY` → baris `0x...` → `PRIVATE_KEY_*` (lama) → `TEST_WALLET_FILE`

Format lama tetap didukung: `PRIVATE_KEY`, `PRIVATE_KEY_1`, `PRIVATE_KEY_2`, ..., `PRIVATE_KEYS_JSON`, `TEST_WALLET_FILE`.

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
