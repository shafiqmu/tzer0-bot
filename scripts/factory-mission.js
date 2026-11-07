#!/usr/bin/env node
// factory-mission.js — PILOT pabrik poin: create mission → backer 0.01 (early 6, late 23) → lift → hold → sell → verify.
// Aturan Tzero yg dipatuhi (docs resmi):
//   - crew +150: backer beli MIN 0.01 di curve, TAHAN 60 mnt, masih pegang saat lift.
//   - liftoff +500: ≥5 wallet LAIN back 0.01+ (held 60 mnt ke atas).
//   - jual/transfer token <60 mnt dari beli = poin buy batal → sell baru setelah hold semua kelar.
//   - creator TIDAK boleh beli mission sendiri (0 poin) → creator gak ikut beli.
// Usage: node scripts/factory-mission.js --run [--name "Nimbus Foundry"] [--ticker NBFO] [--early 6] [--late 23]
// State: analysis/factory_state.json (resumable). Log: logs/factory-1.log
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const NAME = arg('--name', 'Nimbus Foundry');
const TICKER = arg('--ticker', 'NBFO');
const N_EARLY = Number(arg('--early', 6));
const N_LATE = Number(arg('--late', 23));
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const LAUNCHPAD = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';
const BUY_ETH = '0.01'; // nominal backer
const HOLD_MIN = 62; // menit hold minimum sebelum boleh jual

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...xs) => { const l = `[${new Date().toISOString()}] ${xs.join(' ')}`; console.log(l); try { fs.appendFileSync(path.join(ROOT, 'logs', 'factory-1.log'), l + '\n'); } catch (e) {} };

function loadBareKeys(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim()).filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

(async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8'));
  const backers = plan.filter((p) => p.role === 'backer').map((p) => p.addr);
  const creator = plan.find((p) => p.role === 'creator').addr;
  const spares = plan.filter((p) => p.role === 'spare').map((p) => p.addr);
  const stateFile = path.join(A, 'factory_state.json');
  const st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { step: 'create', buys: {}, sells: {} };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));

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

  log(`=== FACTORY PILOT: ${NAME} (${TICKER}) | early ${N_EARLY} + late ${N_LATE} @ ${BUY_ETH} | mode ${RUN ? 'LIVE' : 'DRY'} ===`);
  if (!RUN) { log('dry — berhenti'); return; }

  // ---- STEP 1: CREATE ----
  if (st.step === 'create') {
    const cw = walletOf(creator);
    const fee = await lp.CREATION_FEE();
    const tok = new ethers.Contract(LAUNCHPAD, ['function tokenCount() view returns (uint256)', 'function tokenAt(uint256) view returns (address)'], provider);
    const before = await tok.tokenCount();
    const uri = require('../src/actions/launch').buildUri({ name: NAME, ticker: TICKER });
    const tx = await lp.connect(cw).create(NAME, TICKER, uri, { value: fee, gasLimit: 3000000n });
    const rc = await tx.wait();
    // mission address = token terakhir (tokenCount naik 1)
    const after = await tok.tokenCount();
    let mission = await tok.tokenAt(after - 1n);
    st.mission = mission; st.step = 'early'; st.tsCreate = Date.now();
    save();
    log(`CREATE OK ✅ mission: ${mission} | tx ${rc.hash.slice(0, 18)}`);
  }

  // ---- STEP 2: EARLY BUYS (6) ----
  if (st.step === 'early') {
    for (let i = 0; i < N_EARLY; i++) {
      const b = backers[i];
      if (st.buys[b]) continue;
      const w = walletOf(b);
      for (let t = 1; t <= 3; t++) {
        try {
          const tx = await lp.connect(w).buy(st.mission, 0, { value: ethers.parseEther(BUY_ETH), gasLimit: 3000000n });
          await tx.wait();
          st.buys[b] = { kind: 'early', ts: Date.now(), tx: tx.hash };
          save();
          log(`EARLY ${i + 1}/${N_EARLY} ✅ ${b.slice(0, 10)} ${BUY_ETH} ETH | tx ${tx.hash.slice(0, 18)}`);
          break;
        } catch (e) { log(`EARLY ${i + 1} try ${t} ✗ ${String(e.shortMessage || e.message).slice(0, 90)}`); await sleep(8000); }
      }
      await sleep(30000 + Math.random() * 60000); // jeda 30-90s antar backer
    }
    st.step = 'wait1'; save();
  }

  // ---- STEP 3: WAIT biar backer early held > 60 mnt sebelum lift ----
  if (st.step === 'wait1') {
    const first = Math.min(...Object.values(st.buys).map((x) => x.ts));
    const target = first + HOLD_MIN * 60000;
    const wait = Math.max(0, target - Date.now());
    log(`WAIT1 — nunggu ${(wait / 60000).toFixed(1)} mnt (biar backer early held 60+ mnt saat lift)`);
    await sleep(wait);
    st.step = 'late'; save();
  }

  // ---- STEP 4: LATE BUYS (23) — sampai lift ----
  if (st.step === 'late') {
    const prog = new ethers.Contract(LAUNCHPAD, ['function progressBps(address) view returns (uint256)'], provider);
    for (let i = 0; i < N_LATE; i++) {
      if (Number(await prog.progressBps(st.mission)) >= 10000) { log('sudah LIFT sebelum semua late masuk'); break; }
      const b = backers[N_EARLY + i];
      if (st.buys[b]) continue;
      const w = walletOf(b);
      for (let t = 1; t <= 3; t++) {
        try {
          const tx = await lp.connect(w).buy(st.mission, 0, { value: ethers.parseEther(BUY_ETH), gasLimit: 3000000n });
          await tx.wait();
          st.buys[b] = { kind: 'late', ts: Date.now(), tx: tx.hash };
          save();
          const bps = await prog.progressBps(st.mission);
          log(`LATE ${i + 1}/${N_LATE} ✅ ${b.slice(0, 10)} | bps ${bps}${bps >= 10000 ? ' — LIFT! 🚀' : ''}`);
          break;
        } catch (e) { log(`LATE ${i + 1} try ${t} ✗ ${String(e.shortMessage || e.message).slice(0, 90)}`); await sleep(8000); }
      }
      await sleep(20000 + Math.random() * 30000); // jeda 20-50s
    }
    // top-up pakai spare kalo belum lift
    let bps = Number(await prog.progressBps(st.mission));
    for (const sp of spares) {
      if (bps >= 10000) break;
      const w = walletOf(sp);
      try {
        const tx = await lp.connect(w).buy(st.mission, 0, { value: ethers.parseEther(BUY_ETH), gasLimit: 3000000n });
        await tx.wait();
        st.buys[sp] = { kind: 'spare', ts: Date.now(), tx: tx.hash }; save();
        bps = Number(await prog.progressBps(st.mission));
        log(`SPARE ✅ ${sp.slice(0, 10)} | bps ${bps}`);
      } catch (e) { log(`SPARE ✗ ${String(e.shortMessage || e.message).slice(0, 80)}`); }
      await sleep(15000);
    }
    log(`progress akhir: bps ${bps} ${bps >= 10000 ? '— LIFTED ✅' : '— BELUM LIFT ⚠️'}`);
    st.step = 'wait2'; save();
  }

  // ---- STEP 5: WAIT — semua buy held 60+ mnt baru jual ----
  if (st.step === 'wait2') {
    const lastBuy = Math.max(...Object.values(st.buys).map((x) => x.ts));
    const target = lastBuy + (HOLD_MIN + 3) * 60000;
    const wait = Math.max(0, target - Date.now());
    log(`WAIT2 — nunggu ${(wait / 60000).toFixed(1)} mnt (hold 60+ mnt semua backer)`);
    await sleep(wait);
    st.step = 'sell'; save();
  }

  // ---- STEP 6: SELL semua backer via router ----
  if (st.step === 'sell') {
    const buyers = Object.keys(st.buys);
    let ok = 0, fail = 0;
    for (const b of buyers) {
      if (st.sells[b]) continue;
      const r = spawnSync('node', ['scripts/sell-token.js', '--wallet', b, '--mission', st.mission, '--run'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
      const out = (r.stdout || '') + (r.stderr || '');
      if (/DONE ✅/.test(out)) {
        const m = out.match(/quote ≈ ([\d.]+) ETH/) || out.match(/WETH diterima: ([\d.]+)/);
        st.sells[b] = { ts: Date.now(), gain: m ? m[1] : '0' }; ok++;
        log(`SELL ✅ ${b.slice(0, 10)} +${m ? m[1] : '?'} ETH`);
      } else { fail++; log(`SELL ✗ ${b.slice(0, 10)} ${out.trim().split('\n').slice(-1)[0].slice(0, 80)}`); }
      save();
      await sleep(4000 + Math.random() * 4000);
    }
    log(`SELLS: ${ok} ok | ${fail} gagal`);
    st.step = 'verify'; save();
  }

  // ---- STEP 7: VERIFY POIN ----
  if (st.step === 'verify') {
    await sleep(20000);
    const check = async (addr) => { try { const r = await fetch('https://testnet.tzer0.fun/api/points/' + addr, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch (e) { return null; } };
    const c = await check(creator);
    log(`VERIFY creator ${creator.slice(0, 10)} → ${JSON.stringify(c)}`);
    let n = 0;
    for (const b of Object.keys(st.buys).slice(0, 5)) { const j = await check(b); log(`VERIFY backer ${b.slice(0, 10)} → ${JSON.stringify(j)}`); n++; }
    st.step = 'done'; st.tsDone = Date.now(); save();
    const totalSell = Object.values(st.sells).reduce((a, x) => a + Number(x.gain || 0), 0);
    log(`=== FACTORY PILOT SELESAI: mission ${st.mission} | backers ${Object.keys(st.buys).length} | ETH balik ≈ ${totalSell.toFixed(4)} ===`);
  }
  log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
