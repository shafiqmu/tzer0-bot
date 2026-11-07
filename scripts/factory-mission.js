#!/usr/bin/env node
// factory-mission.js — siklus pabrik poin. Dua fase (buat jalur pipa cepat):
//   --phase seed : create mission + 6 backer "pemanasan" beli (umur 60 mnt jalan paralel di background)
//   --phase burst: 23 backer terakhir beli → mission LIFT → jual semua (per-wallet, nunggu umur 61 mnt masing2) → verify
//   (default: full = seed lalu lanjut burst di proses yg sama)
// Aturan Tzero (docs resmi):
//   - crew +150: backer beli MIN 0.01 di curve, TAHAN 60 mnt, masih pegang saat lift.
//   - liftoff +500: ≥5 wallet LAIN back 0.01+ dan tahan 60 mnt (seed 6 kita jamin umur 61+ mnt saat lift).
//   - jual token <60 mnt dari beli = poin batal → tiap wallet jual pas umurnya ≥61 mnt.
//   - creator gak boleh beli mission sendiri.
// Usage: node scripts/factory-mission.js --run --plan X --state S --log L [--name N] [--ticker T]
//        [--phase seed|burst|full] [--early 6] [--buyeth 0.01] [--spares 1]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const resolveP = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const PLAN_FILE = resolveP(arg('--plan', 'analysis/factory_plan.json'));
const STATE_FILE = resolveP(arg('--state', 'analysis/factory_state.json'));
const LOG_FILE = resolveP(arg('--log', 'logs/factory-1.log'));
const NAME = arg('--name', 'Nimbus Foundry');
const TICKER = arg('--ticker', 'NBFO');
const PHASE = arg('--phase', 'full'); // seed | burst | full
const N_EARLY = Number(arg('--early', 6));
const BUY_ETH = arg('--buyeth', '0.01');
const USE_SPARES = arg('--spares', '1') !== '0';
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const LAUNCHPAD = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';
const HOLD_MS = 61 * 60000; // umur minimum wallet sebelum boleh jual (buffer 1 mnt di atas 60)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...xs) => { const l = `[${new Date().toISOString()}] ${xs.join(' ')}`; console.log(l); try { fs.appendFileSync(LOG_FILE, l + '\n'); } catch (e) {} };
const jitterBuy = () => (BigInt(Math.round(Number(BUY_ETH) * 1e6 * (0.96 + Math.random() * 0.08))) * 10n ** 12n);

function loadBareKeys(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim()).filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

(async () => {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const backers = plan.filter((p) => p.role === 'backer').map((p) => p.addr);
  const creator = plan.find((p) => p.role === 'creator').addr;
  const spares = plan.filter((p) => p.role === 'spare').map((p) => p.addr);
  const st = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { step: 'create', buys: {}, sells: {} };
  const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1));

  const provider = new ethers.JsonRpcProvider(RPC);
  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const w = new ethers.Wallet(k); byAddr.set(w.address.toLowerCase(), k); } catch (e) {} }
  const walletOf = (a) => new ethers.Wallet(byAddr.get(a.toLowerCase()), provider);
  const lp = new ethers.Contract(LAUNCHPAD, [
    'function create(string,string,string) payable returns (address)',
    'function buy(address,uint256) payable',
    'function progressBps(address) view returns (uint256)',
    'function CREATION_FEE() view returns (uint256)',
  ], provider);
  const prog = new ethers.Contract(LAUNCHPAD, ['function progressBps(address) view returns (uint256)'], provider);

  // kompat resume state lama: wait1≈seeded, wait2≈sell
  if (st.step === 'wait1') st.step = 'seeded';
  if (st.step === 'wait2') st.step = 'sell';

  log(`=== FACTORY [${PHASE}] ${NAME} (${TICKER}) | backer ${backers.length} | buy ~${BUY_ETH} | step: ${st.step} | ${RUN ? 'LIVE' : 'DRY'} ===`);
  if (!RUN) { log('dry — berhenti'); return; }

  // STEP 1: CREATE
  if (st.step === 'create') {
    const cw = walletOf(creator);
    const fee = await lp.CREATION_FEE();
    const tok = new ethers.Contract(LAUNCHPAD, ['function tokenCount() view returns (uint256)', 'function tokenAt(uint256) view returns (address)'], provider);
    const uri = require('../src/actions/launch').buildUri({ name: NAME, ticker: TICKER });
    const tx = await lp.connect(cw).create(NAME, TICKER, uri, { value: fee, gasLimit: 3000000n });
    const rc = await tx.wait();
    const after = await tok.tokenCount();
    const mission = await tok.tokenAt(after - 1n);
    st.mission = mission; st.step = 'early'; st.tsCreate = Date.now(); st.name = NAME; st.ticker = TICKER;
    save();
    log(`CREATE OK ✅ mission: ${mission} | tx ${rc.hash.slice(0, 18)}`);
  }

  // STEP 2: SEED BUYS (6 backer pemanasan)
  if (st.step === 'early') {
    for (let i = 0; i < Math.min(N_EARLY, backers.length); i++) {
      const b = backers[i];
      if (st.buys[b]) continue;
      const w = walletOf(b);
      for (let t = 1; t <= 3; t++) {
        try {
          const tx = await lp.connect(w).buy(st.mission, 0, { value: jitterBuy(), gasLimit: 3000000n });
          await tx.wait();
          st.buys[b] = { kind: 'seed', ts: Date.now(), tx: tx.hash }; save();
          log(`SEED ${i + 1} ✅ ${b.slice(0, 10)} | tx ${tx.hash.slice(0, 18)}`);
          break;
        } catch (e) { log(`SEED ${i + 1} try ${t} ✗ ${String(e.shortMessage || e.message).slice(0, 90)}`); await sleep(6000); }
      }
      await sleep(8000 + Math.random() * 12000); // jeda 8-20s
    }
    st.step = 'seeded'; save();
  }

  // fase seed = sampai sini aja (umur 60 mnt dijalanin paralel oleh si jalur)
  if (st.step === 'seeded' && PHASE === 'seed') { log('SEEDED ✅ (umur jalan dari sekarang)'); return; }

  // STEP 3: tunggu umur seed (kalau perlu) → LATE BUYS sampai lift
  if (st.step === 'seeded') {
    const firstSeed = Math.min(...Object.values(st.buys).map((x) => x.ts));
    const wait = Math.max(0, firstSeed + HOLD_MS - Date.now());
    if (wait > 0) log(`nunggu umur seed ${(wait / 60000).toFixed(1)} mnt...`);
    await sleep(wait);
    st.step = 'late'; save();
  }

  if (st.step === 'late') {
    const lateList = backers.filter((b) => !st.buys[b]); // semua yg belum beli (termasuk seed yg gagal)
    for (let i = 0; i < lateList.length; i++) {
      if (Number(await prog.progressBps(st.mission)) >= 10000) { log('sudah LIFT sebelum semua late masuk'); break; }
      const b = lateList[i];
      if (!b || st.buys[b]) continue;
      const w = walletOf(b);
      for (let t = 1; t <= 3; t++) {
        try {
          const tx = await lp.connect(w).buy(st.mission, 0, { value: jitterBuy(), gasLimit: 3000000n });
          await tx.wait();
          st.buys[b] = { kind: 'burst', ts: Date.now(), tx: tx.hash }; save();
          const bps = Number(await prog.progressBps(st.mission));
          log(`BURST ${i + 1}/${lateList.length} ✅ ${b.slice(0, 10)} | bps ${bps}${bps >= 10000 ? ' — LIFT! 🚀' : ''}`);
          break;
        } catch (e) { log(`BURST ${i + 1} try ${t} ✗ ${String(e.shortMessage || e.message).slice(0, 90)}`); await sleep(6000); }
      }
      await sleep(5000 + Math.random() * 9000); // jeda 5-14s
    }
    // top-up spare kalau belum lift
    let bps = Number(await prog.progressBps(st.mission));
    if (USE_SPARES) for (const sp of spares) {
      if (bps >= 10000) break;
      const w = walletOf(sp);
      try {
        const tx = await lp.connect(w).buy(st.mission, 0, { value: jitterBuy(), gasLimit: 3000000n });
        await tx.wait();
        st.buys[sp] = { kind: 'spare', ts: Date.now(), tx: tx.hash }; save();
        bps = Number(await prog.progressBps(st.mission));
        log(`SPARE ✅ ${sp.slice(0, 10)} | bps ${bps}`);
      } catch (e) { log(`SPARE ✗ ${String(e.shortMessage || e.message).slice(0, 80)}`); }
      await sleep(10000);
    }
    log(`progress: bps ${bps} ${bps >= 10000 ? '— LIFTED ✅' : '— BELUM LIFT ⚠️'}`);
    st.step = 'sell'; save();
  }

  // STEP 4: SELL — tiap wallet jual PAS umurnya ≥61 mnt (urut umur), jeda 2-5s
  if (st.step === 'sell') {
    const buyers = Object.keys(st.buys).sort((a, b) => st.buys[a].ts - st.buys[b].ts);
    let ok = 0, fail = 0;
    for (const b of buyers) {
      if (st.sells[b]) continue;
      const due = st.buys[b].ts + HOLD_MS;
      const wait = due - Date.now();
      if (wait > 0) { log(`nunggu umur ${b.slice(0, 10)} ${(wait / 60000).toFixed(1)} mnt...`); await sleep(wait); }
      const r = spawnSync('node', ['scripts/sell-token.js', '--wallet', b, '--mission', st.mission, '--run'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
      const out = (r.stdout || '') + (r.stderr || '');
      if (/DONE ✅/.test(out)) {
        const m = out.match(/quote ≈ ([\d.]+) ETH/) || out.match(/WETH diterima: ([\d.]+)/);
        st.sells[b] = { ts: Date.now(), gain: m ? m[1] : '0' }; ok++;
        log(`SELL ✅ ${b.slice(0, 10)} +${m ? m[1] : '?'} ETH`);
      } else { fail++; log(`SELL ✗ ${b.slice(0, 10)} ${out.trim().split('\n').slice(-1)[0].slice(0, 80)}`); }
      save();
      await sleep(2500 + Math.random() * 2500);
    }
    log(`SELLS: ${ok} ok | ${fail} gagal`);
    st.step = 'verify'; save();
  }

  // STEP 5: VERIFY POIN
  if (st.step === 'verify') {
    await sleep(15000);
    const check = async (addr) => { try { const r = await fetch('https://testnet.tzer0.fun/api/points/' + addr, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch (e) { return null; } };
    let sum = 0, n = 0;
    for (const a of [creator, ...Object.keys(st.buys)]) { const j = await check(a); if (j && typeof j.total === 'number') { sum += j.total; n++; } await sleep(120); }
    const totalSell = Object.values(st.sells).reduce((a, x) => a + Number(x.gain || 0), 0);
    st.totalPoints = sum; st.nChecked = n;
    st.step = 'done'; st.tsDone = Date.now(); save();
    log(`=== SELESAI: ${NAME} | mission ${st.mission} | backers ${Object.keys(st.buys).length} | ETH balik ≈ ${totalSell.toFixed(4)} | poin wallet peserta ≈ ${sum} (${n}) ===`);
  }
  log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
