# OPS NOTES — TZero Farming (arsip 11/11)

Dokumen ini = kenangan lengkap operasi farming TZero testnet (Base Sepolia).
Status akhir: **FASE 1 SELESAI — 1000/1000 wallet ≥500 poin. Operasi di-wind-down,
kas armada ditarik semua, mesin dimatikan.** Dokumen ini buat kalau nanti mau update/lanjut (Fase 2: semua >2000).

---

## 1. Aturan poin (dari app TZero, verbatim)

- **Fuel/Kurva**: beli min 0,0005 ETH (di bawah itu = dust, gak dihitung). Total 1 ETH = 1.000 poin (max 1 ETH/hari/wallet). Beli **<60 menit lalu jual = poin BATAL**.
- **Crew +150/misi**: wallet ikut back mission (min beli 0,01 ETH), tahan **≥60 menit**, dan masih pegang saat liftoff. Cap 5 crew/hari/wallet.
- **Liftoff +500**: cuma buat CREATOR mission (misinya harus di-back ≥5 wallet lain, masing-masing ≥0,01 & tahan 60 mnt).
- **Staking $T0**: pool 5.000/hari, cap 1.000/wallet.
- **Eligible = 500 poin** → Season 0 bagi 5% supply.
- Ada "public review buang farm cluster" sebelum snapshot final → makanya strategi desain anti-pola-seragam (amount/timing beda-beda, ada buffer).

## 2. Fisik operasi

- **1.000 wallet** (derive dari master list), key satu-per-baris di `.env` polos (loadBareKeys). Relay & funder **TIDAK** di repo — key relay di `.env`, funder dipegang user (jangan pernah masuk VPS/repo).
- **Kontrak TZero Base Sepolia (publik, boleh catat):**
  - Launchpad `0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c`
  - Router `0x21BbD201c69d0091707d0367D3AD6875cEc150e1`
  - Factory `0xf9CE1F9D20d5d42515b27fE2A5380B89A0Be927E`
  - FeeSplitter `0x1C69a90c69fdb2F2E459fCA23cA6B22ACD707B3b` (creator fees — claim massal!)
  - WETH `0x4200000000000000000000000000000000000006`
- **Mekanik lift misi**: kurva butuh ~0,28335 ETH net utk liftoff. 25 backer × A_BUY 0,0114 ≈ fill ~97% → gap kecil ditutup "trigger wallet" @ menit 60,1 (aman buat crew + anti bot completer).
- **A_BUY 0,0114 (!!)** — JANGAN turunin lagi. 0,0102 bikin fill ~89% dan bot completer nyamber lift @ ≤31 mnt (<60 mnt = crew kebakar).

## 3. Mesin (scripts/)

| Script | Fungsi |
|---|---|
| `factory-line.js` | Mesin utama lap: window 27-28 wallet/lap, retry funding 8×, resume-safe via `analysis/line_stateN.json` |
| `factory-mission.js` | Satu misi: `--phase seed` (buat misi + 25 beli) → `--phase trigger` (tunggu ≥61 mnt + gap buy + jual) |
| `consolidate.js` | Funding mover: donor→target per plan `[{addr,want}]`; flags `--run --dry --exclude --reserve` |
| `mini-lap.js` | Fast-track 9 wallet <500: siklus = fund → seed → hold 62 mnt → trigger; auto-stop kalau semua ≥goal |
| `mini-chain.sh` | Wrapper: mini eksklusif → resume lap-8 → conductor |
| `lap-conductor.js` | Auto-lanjut lap berikutnya |
| `audit-cash.js` | Scan semua wallet → NET on-chain (masuk−keluar). **Satu-satunya sumber kebenaran kas.** |
| `claim-creator-fees.js` | Klaim 50% creator fee dari semua misi kita (income pasif, rutin!) |
| `fix-timer.js` | Rescue misi nyangkut per-misi |
| `points-scan2.js` | Scan poin 1000 wallet via API (sabar nunggu 'warming') |
| `market-heatmap2.js` | Riset: pelacak pembeli luar misi (buat lihat bot completer/sniper) |

## 4. PITFALLS (pelajaran mahal — baca sebelum update!)

1. **consolidate target-donor trap** (root cause funding mentok 17/27): target dulu auto-exclude dari donor → saldo LEBIH di wallet target (mis. parkir siklus ke-skip 0,09+0,06) beku selamanya. **FIX (sudah in): target boleh donor KELEBIHAN di atas want-nya** (`keep = max(want, RESERVE)`).
2. **Exclude file basi = duit terkunci**: exclude dibangun dari fase misi; entry fase mati ('seeding' stale) ngunci parkiran. **Selalu rebuild exclude segar; filter = hanya fase hidup** (`aged/trigger/sell/wait1/wait2/burst`).
3. **Watchdog cron `tzero-factory-watch` revive factory-line** tiap mati → rebutan kas saat operasi eksklusif. **Pause semua cron dulu.**
4. **Patch script ≠ proses jalan**: `consolidate.js` (subprocess per attempt) = patch langsung kepakai; `mini-lap/factory-line` (long-running) = HARUS restart.
5. **Kill wrapper dulu**: bash `mini-chain.sh` yang masih hidup lanjut ke fase berikutnya (bikin factory-line baru!!). Kill by-PID: `ps -eo pid,cmd | awk '/scripts\/mini-lap[.]js/{print $1}' | xargs kill` — jangan `pkill -f` polos (self-match, shell bunuh diri).
6. **Kas hand-to-mouth**: siklus butuh ~0,30-0,33; hasil jual balik ~0,25-0,28 → **deficit ~0,02-0,05/siklus** — ditambal dari: floor-drain (`--reserve` turun), creator fees, atau top-up. Kalau funding mentok berulang = cek ini, bukan bug.
7. **Hold 62 mnt di mini** = buffer di atas aturan 60 (jangan pas-pasan).

## 5. Wind-down (resep terbukti — recovered 0,964 ETH)

1. Kill wrapper chain **saja** → biarin mini selesai misi terakhir & auto-jual (kalau dibunuh mentah, ~0,28 mati di kurva).
2. Pause semua cron tzero. Panen creator fees terakhir.
3. Sweep bertahap pakai consolidate: plan = `[{addr:"TUJUAN", want:"999"}]`, exclude = wallet misi hidup.
   - Pass 1: `--reserve 0.0006` (aman). Pass 2: `--reserve 0.0001`. Pass 3 (kikis floor): `--reserve 0.00002` + patch `MIN_MOVE` 0.0002→0.00001.
   - Gas transfer polos ~0,00002-0,00005/tx — sisa <0,00004/wallet gak ekonomis, biarin (dust ~0,02).
4. Verifikasi delta saldo TUJUAN pakai scan on-chain — itu angka laporannya.

## 6. Hasil akhir

- **Poin: 1000/1000 ≥500** (median 1.132, max 2.473).
- **Kas: ~0,964 ETH ditarik balik ke wallet user; dust 0,02 nyangkut (fisik gak bisa diangkut).**
- 5 siklus mini sukses (Cinder Vault, Willow Bazaar, Onyx Plateau, Velvet Harbor, Quartz Canyon) + 7 lap produksi.
- **Kalau lanjut Fase 2 (>2000/misi lebih banyak): tinggal idupin lagi — sweep balik modal ke armada, nyalain crons, resume.**

## 7. Setup cepat (kalau restore)

```bash
npm install
cp .env.example .env   # isi RPC + private key 1-per-baris (polos)
node scripts/points-scan2.js          # cek poin armada
node scripts/audit-cash.js            # cek kas
node scripts/claim-creator-fees.js    # panen fee
node scripts/factory-line.js --run --lap<N>   # lanjut produksi
```

⚠️ **Aturan repo ini PUBLIK**: JANGAN pernah commit `.env`, `analysis/`, `logs/`, atau alamat pribadi (funder/relay/temen). Sensitif → biarkan di `.gitignore`.
