#!/usr/bin/env node
// factory-mission.js v3 — JALUR "FASE A + PEMICU" (crew penuh untuk semua backer):
//
//  Kenapa: crew butuh "beli ≥0.01 + tahan 60 mnt + masih pegang PAS liftoff".
//  Kalau backer beli detik2 terakhir sebelum lift (desain lama), dia bisa kehilangan crew.
//  Solusi: SEMUA backer (27) beli DULUAN (fase A) → umur 60+ mnt jalan → baru kurva
//  diselesaikan oleh SATU wallet pemicu (backer terakhir) → liftoff. Semua backer fase A
//  dijamin: beli ≥0.01 ✓, tahan 61+ mnt pas lift ✓, masih pegang pas lift ✓.
//
//  Matematika kurva (kalibrasi on-chain): butuh 0.28335 ETH NET (setelah fee) buat liftoff.
//  Fase A: 27 backer × ~0.0102 = ~0.2726 net (96%) → sisa ~0.0108 net diisi pemicu (dinamis, ada refund).
//
//  Fase:
//   --phase seed    : create + isi FASE A → step 'aged' (umur jalan di background)
//   --phase trigger : backer terakhir beli sisa kurva → LIFTOFF → jual semua backer (pas umurnya 61 mnt) → verify
//   --phase full    : seed lalu langsung trigger (manual/debug)
//
// Usage: node scripts/factory-mission.js --run --phase seed|trigger|full --plan P --state S --log L [--name --ticker]
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
const PHASE = arg('--phase', 'full'); // seed | trigger | full
const A_BUY = Number(arg('--buyeth', '0.0102')); // ukuran beli Fase A (≥0.01 wajibnya)
const MAXA = 27; // maks wallet fase A (27 × 0.0102 = 0.2754 gross ≈ 96% kurva)
const LIFT_NET = 0.28335; // ETH NET buat liftoff (kalibrasi on-chain dari kurva)
const HOLD_MS = 61 * 60000;
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const LAUNCHPAD = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...xs) => { const l = `[${new Date().toISOString()}] ${xs.join(' ')}`; console.log(l); try { fs.appendFileSync(LOG_FILE, l + '\n'); } catch (e) {} };
const jitterA = () => (BigInt(Math.round(A_BUY * 1e6 * (1.0 + Math.random() * 0.03))) * 10n ** 12n);

function loadBareKeys(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim()).filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

(async () => {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  const backers = plan.filter((p) => p.role === 'backer').map((p) => p.addr);
  const creator = plan.find((p) => p.role === 'creator').addr;
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
    'function curve(address) view returns (address creator, uint256 idx, bool graduated, address pair, uint256 vNative, uint256 vToken, uint256 realNative, uint256 soldTokens)',
    'function CREATION_FEE() view returns (uint256)',
  ], provider);
  const prog = new ethers.Contract(LAUNCHPAD, ['function progressBps(address) view returns (uint256)'], provider);

  // kompat state lama (v2): early/seeded → phaseA ; late/wait1/wait2/burst → trigger
  const MAP = { early: 'phaseA', seeded: 'phaseA', seeding: 'phaseA', wait1: 'trigger', wait2: 'trigger', late: 'trigger', burst: 'trigger', sell: 'sell', verify: 'verify', done: 'done' };
  if (MAP[st.step]) st.step = MAP[st.step];

  // set fase A & pemicu
  const phaseAList = backers.slice(0, Math.min(MAXA, Math.max(1, backers.length - 1)));
  const triggerAddr = backers[backers.length - 1];

  log(`=== FACTORY v3 [${PHASE}] ${NAME} (${TICKER}) | backer ${backers.length} | faseA ${phaseAList.length}×~${A_BUY} | pemicu ${triggerAddr.slice(0, 10)} | step ${st.step} | ${RUN ? 'LIVE' : 'DRY'} ===`);
  if (!RUN) { log('dry'); return; }

  // STEP: CREATE
  if (st.step === 'create') {
    const cw = walletOf(creator);
    const fee = await lp.CREATION_FEE();
    const tok = new ethers.Contract(LAUNCHPAD, ['function tokenCount() view returns (uint256)', 'function tokenAt(uint256) view returns (address)'], provider);
    const uri = require('../src/actions/launch').buildUri({ name: NAME, ticker: TICKER });
    const tx = await lp.connect(cw).create(NAME, TICKER, uri, { value: fee, gasLimit: 3000000n });
    await tx.wait();
    const after = await tok.tokenCount();
    st.mission = await tok.tokenAt(after - 1n);
    st.step = 'phaseA'; st.tsCreate = Date.now(); st.name = NAME; st.ticker = TICKER;
    save();
    log(`CREATE OK ✅ mission: ${st.mission}`);
  }

  // STEP: FASE A — backer beli duluan (jeda 5-12s biar gak seragam)
  if (st.step === 'phaseA') {
    let done = 0;
    for (const b of phaseAList) {
      if (st.buys[b]) { done++; continue; }
      const w = walletOf(b);
      let ok = false;
      for (let t = 1; t <= 3 && !ok; t++) {
        try {
          const tx = await lp.connect(w).buy(st.mission, 0, { value: jitterA(), gasLimit: 3000000n });
          await tx.wait();
          st.buys[b] = { kind: 'phaseA', ts: Date.now(), tx: tx.hash }; save();
          ok = true; done++;
          log(`FASE A ${done}/${phaseAList.length} ✅ ${b.slice(0, 10)} | tx ${tx.hash.slice(0, 18)}`);
        } catch (e) {
          const msg = String(e.shortMessage || e.message).slice(0, 80);
          if (/graduated|LIFT/i.test(msg)) { log('FASE A: kurva udah lift duluan — stop.'); break; }
          log(`FASE A ${b.slice(0, 10)} try ${t} ✗ ${msg}`);
          await sleep(6000);
        }
      }
      await sleep(5000 + Math.random() * 7000);
    }
    st.step = 'aged'; save();
    log(`FASE A SELESAI (${done}/${phaseAList.length}) → AGED ✅ (umur jalan dari beli terakhir)`);
  }

  if (st.step === 'aged' && PHASE === 'seed') { log('AGED ✅ (fase seed stop di sini)'); return; }
  if (st.step === 'aged') {
    st.step = 'trigger'; save();
  }

  // STEP: TRIGGER — backer terakhir isi sisa kurva (beli dinamis + refund otomatis) → LIFTOFF
  if (st.step === 'trigger') {
    const w = walletOf(triggerAddr);
    let lifted = false;
    for (let a = 1; a <= 4; a++) {
      const c = await lp.curve(st.mission);
      if (c.graduated) { lifted = true; log('PEMICU: kurva UDAH lift (bot completer nyamber duluan) — langsung jual.'); break; }
      const gapWei = BigInt(Math.round(LIFT_NET * 1e18)) - c.realNative;
      if (gapWei <= 400000000000000n) break; // praktis penuh — cek graduated di bawah
      let value = (gapWei * 109n) / 99n; // net / 0.99 + margin
      if (value < 700000000000000n) value = 700000000000000n;
      try {
        log(`PEMICU try ${a}: beli ${ethers.formatEther(value)} ETH (sisa kurva net ${ethers.formatEther(gapWei > 0n ? gapWei : 0n)})...`);
        const tx = await lp.connect(w).buy(st.mission, 0, { value, gasLimit: 3000000n });
        await tx.wait();
        st.buys[triggerAddr] = { kind: 'trigger', ts: Date.now(), tx: tx.hash }; save();
        await sleep(4000);
        const bps = Number(await prog.progressBps(st.mission));
        log(`PEMICU ✅ bps ${bps}${bps >= 10000 ? ' — LIFTOFF! 🚀' : ''}`);
        if (bps >= 10000) { lifted = true; break; }
      } catch (e) {
        log(`PEMICU ✗ ${String(e.shortMessage || e.message).slice(0, 90)}`);
        await sleep(6000);
      }
    }
    if (!lifted) {
      const c2 = await lp.curve(st.mission);
      if (c2.graduated || (await prog.progressBps(st.mission)).toString() === '10000') { lifted = true; }
      else {
        st.triggerAddr = triggerAddr; st.triggerTs = st.buys[triggerAddr] ? st.buys[triggerAddr].ts : Date.now();
        save();
        log('⚠️ BELUM LIFT — keluar; jalur bakal ulang pemicu.');
        return;
      }
    }
    st.triggerAddr = triggerAddr;
    st.triggerTs = st.buys[triggerAddr] ? st.buys[triggerAddr].ts : Date.now();
    st.step = 'sell'; save();
  }

  // STEP: SELL — tunggu lift dulu (jangan jual sebelum liftoff = crew kebakar), lalu tiap backer jual pas umurnya ≥61 mnt
  if (st.step === 'sell') {
    let lifted = false;
    for (let i = 0; i < 40; i++) {
      if (Number(await prog.progressBps(st.mission)) >= 10000) { lifted = true; break; }
      await sleep(15000);
    }
    if (!lifted) { log('⚠️ belum lift — tunda jual (biar crew gak kebakar).'); return; }
    const buyers = Object.keys(st.buys).filter((b) => st.buys[b].kind !== 'trigger').sort((a, b) => st.buys[a].ts - st.buys[b].ts);
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

  // STEP: VERIFY
  if (st.step === 'verify') {
    await sleep(15000);
    const check = async (addr) => { try { const r = await fetch('https://testnet.tzer0.fun/api/points/' + addr, { signal: AbortSignal.timeout(8000) }); return await r.json(); } catch (e) { return null; } };
    let sum = 0, n = 0;
    for (const a of [creator, ...Object.keys(st.buys)]) { const j = await check(a); if (j && typeof j.total === 'number') { sum += j.total; n++; } await sleep(120); }
    const totalSell = Object.values(st.sells).reduce((a, x) => a + Number(x.gain || 0), 0);
    st.totalPoints = sum; st.nChecked = n;
    st.step = 'done'; st.tsDone = Date.now(); save();
    log(`=== SELESAI: ${NAME} | mission ${st.mission} | backer ${Object.keys(st.buys).length} | ETH balik ≈ ${totalSell.toFixed(4)} | poin ≈ ${sum} (${n} wallet) ===`);
  }
  log('DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
