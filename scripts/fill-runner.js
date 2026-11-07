#!/usr/bin/env node
/**
 * fill-runner.js — isi 14 mission pakai 4.004 tiket dari 1.000 wallet.
 *
 * Cara pakai (root repo):
 *   node scripts/fill-runner.js --dry               # ringkasan rencana (tanpa tx)
 *   node scripts/fill-runner.js --run --limit 10    # TES dulu: 10 tx
 *   node scripts/fill-runner.js --run               # FULL
 *   node scripts/fill-runner.js --status            # progress tiket + progress mission (API)
 *   node scripts/fill-runner.js --run --retry-failed  # ulangi yang gagal
 *   Opsi lain: --min-delay 15 --max-delay 60 --mission m3 --notify
 *
 * Sifat:
 *   - Interleave: tiap ronde, 1 tiket dari tiap mission (urutan diacak) — semua mission maju bareng
 *   - Tiket besar (0.0012) per mission dikirim PALING AKHIR setelah semua small-nya beres
 *   - Resumable: mati kapan aja, jalanin lagi = lanjut (state: analysis/fill_state.json)
 *   - Retry otomatis 3x per tiket; yang tetap gagal masuk daftar failed (bisa --retry-failed)
 *   - AUTO-SKIP: kalau buy mission balas GRADUATED (mission lift duluan), sisa tiketnya
 *     otomatis ditandai skip (cek via staticCall, cache 10 menit/mission)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { buyMission } = require('../src/actions/mission');

const ROOT = path.join(__dirname, '..');
const ANALYSIS = path.join(ROOT, 'analysis');
const STATE_PATH = path.join(ANALYSIS, 'fill_state.json');
const LOG_PATH = path.join(ANALYSIS, 'fill_log.txt');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
function argNum(argv, name, def) { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : def; }
function argStr(argv, name, def) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; }

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

function loadState() { return fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : { tickets: {}, startedAt: Date.now() }; }
function saveState(state) { fs.writeFileSync(STATE_PATH, JSON.stringify(state)); }
function log(line) { try { fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${line}\n`); } catch (e) {} }
function notify(msg) { try { require('child_process').execSync(`termux-notification --title \"TZERO FILL\" --content ${JSON.stringify(msg)}`, { stdio: 'ignore' }); } catch (e) {} }

const ticketDone = (state, t) => state.tickets[t.id] && state.tickets[t.id].status === 'done';
const ticketDead = (state, t) => state.tickets[t.id] && state.tickets[t.id].status === 'failed';

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--status') ? 'status' : argv.includes('--run') ? 'run' : 'dry';
  const retryFailed = argv.includes('--retry-failed');
  const doNotify = argv.includes('--notify');
  const limit = argNum(argv, '--limit', Infinity);
  const minDelay = argNum(argv, '--min-delay', 20);
  const maxDelay = argNum(argv, '--max-delay', 50);
  const onlyMission = argStr(argv, '--mission', null);

  const alloc = JSON.parse(fs.readFileSync(path.join(ANALYSIS, 'allocator_14m.json'), 'utf8'));
  const allMissions = Object.keys(alloc.missions).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const useMissions = onlyMission ? [onlyMission] : allMissions;
  for (const k of useMissions) if (!alloc.missions[k]) { console.error(`❌ mission ${k} gak ada di allocator`); process.exit(1); }

  // alamat mission (hasil launch-creators.js)
  const addrOf = {};
  const mf = path.join(ANALYSIS, 'missions_14.json');
  if (fs.existsSync(mf)) {
    const data = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const [k, v] of Object.entries(data.missions || {})) addrOf[k] = v.address;
  }

  const state = loadState();

  // antrian
  const Q = {};
  for (const k of useMissions) {
    const slots = alloc.missions[k].slots.map((s, idx) => ({ id: `${k}#${idx}`, mission: k, wallet: s.wallet, amount: s.amount, type: s.type }));
    if (retryFailed) for (const t of slots) if (state.tickets[t.id] && state.tickets[t.id].status === 'failed') delete state.tickets[t.id];
    const smalls = slots.filter((s) => s.type === 'small');
    const big = slots.find((s) => s.type === 'big') || null;
    Q[k] = { smalls: shuffle(smalls), big };
  }

  const counts = () => {
    let pend = 0, done = 0, fail = 0;
    for (const k of useMissions) {
      const tiles = [...Q[k].smalls, Q[k].big].filter(Boolean);
      for (const t of tiles) {
        if (ticketDone(state, t)) done++;
        else if (ticketDead(state, t)) fail++;
        else pend++;
      }
    }
    return { pend, done, fail };
  };

  if (mode === 'status') {
    const c = counts();
    console.log(`📊 Tiket: done=${c.done} pending=${c.pend} failed=${c.fail}`);
    for (const k of useMissions) {
      if (!addrOf[k]) { console.log(`   ${k}: (belum ada address — launch belum jalan?)`); continue; }
      try {
        const r = await fetch(`https://testnet.tzer0.fun/api/missions/${addrOf[k]}`);
        const d = await r.json();
        const m = d.mission || d;
        console.log(`   ${k} ${alloc.missions[k].name}: progress=${m.progressPercent ?? '?'}% graduated=${m.graduated}`);
      } catch (e) { console.log(`   ${k}: API error ${e.message}`); }
      await sleep(300);
    }
    return;
  }

  if (mode === 'dry') {
    const c = counts();
    console.log(`DRY — mission: ${useMissions.join(', ')}`);
    console.log(`Tiket: total=${c.pend + c.done + c.fail} (done=${c.done}, pending=${c.pend}, failed=${c.fail})`);
    console.log(`Estimasi durasi full (jeda ${minDelay}-${maxDelay} dtk): ${((c.pend * (minDelay + maxDelay) / 2) / 3600).toFixed(1)} jam`);
    const sample = Q[useMissions[0]].smalls.filter((t) => !ticketDone(state, t)).slice(0, 5);
    sample.forEach((t) => console.log(`   contoh: ${t.id}  ${t.wallet}  ${t.amount}`));
    return;
  }

  // === RUN ===
  for (const k of useMissions) if (!addrOf[k]) { console.error(`❌ alamat ${k} belum ada. Jalanin dulu: node scripts/launch-creators.js --run`); process.exit(1); }

  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const a = new ethers.Wallet(k).address.toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, k); } catch (e) {} }
  console.log(`🔑 key .env: ${keys.length} | mode: LIVE | jeda ${minDelay}-${maxDelay} dtk | limit ${limit === Infinity ? '∞' : limit}`);

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const walletCache = new Map();
  const getSigner = (addr) => {
    const lc = addr.toLowerCase();
    if (!walletCache.has(lc)) {
      const key = byAddr.get(lc);
      if (!key) throw new Error(`no key in .env for ${addr}`);
      walletCache.set(lc, new ethers.Wallet(key, provider));
    }
    return walletCache.get(lc);
  };

  // --- auto-skip utk mission yang sudah GRADUATED (cek staticCall, cache 10 menit) ---
  const LPB = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function buy(address mission, uint256 minTokens) payable'], provider);
  const gradCache = {};
  async function isGrad(k) {
    const g = gradCache[k];
    if (g && Date.now() - g.ts < 600000) return g.val;
    let val = false;
    try { await LPB.buy.staticCall(addrOf[k], 0n, { value: ethers.parseEther('0.001') }); }
    catch (e) { val = /GRADUATED/.test(String(e.shortMessage || e.message)); }
    gradCache[k] = { ts: Date.now(), val };
    return val;
  }
  function markSkip(t) {
    state.tickets[t.id] = { status: 'failed', attempts: 3, error: 'auto-skip: GRADUATED', wallet: t.wallet, ts: Date.now() };
    saveState(state);
    log(`SKIP ${t.id} graduated`);
    console.log(`⏭️  ${t.id} skip (graduated)`);
  }

  async function execTicket(t) {
    try {
      const signer = getSigner(t.wallet);
      const r = await buyMission(signer, addrOf[t.mission], t.amount);
      state.tickets[t.id] = { status: 'done', txHash: r.txHash, gasUsed: r.gasUsed, amount: t.amount, wallet: t.wallet, ts: Date.now() };
      saveState(state);
      log(`OK ${t.id} ${t.wallet} ${t.amount} gas=${r.gasUsed} tx=${r.txHash}`);
      console.log(`✅ ${t.id} ${t.wallet.slice(0, 10)}.. ${t.amount} | ${r.txHash.slice(0, 16)}..`);
      return true;
    } catch (e) {
      const prev = state.tickets[t.id] || {};
      const attempts = (prev.attempts || 0) + 1;
      state.tickets[t.id] = { status: attempts >= 3 ? 'failed' : 'retry', attempts, error: String(e.shortMessage || e.message), wallet: t.wallet, ts: Date.now() };
      saveState(state);
      log(`ERR ${t.id} ${t.wallet} attempt=${attempts} ${e.shortMessage || e.message}`);
      console.error(`❌ ${t.id} ${t.wallet.slice(0, 10)}..: ${e.shortMessage || e.message} (attempt ${attempts})`);
      return false;
    }
  }

  let sent = 0, doneTotal = 0;
  const t0 = Date.now();
  mainLoop:
  while (true) {
    let progressed = false;
    for (const k of shuffle(useMissions.slice())) {
      const q = Q[k];
      let acted = false;
      while (q.smalls.length) {
        const t = q.smalls[0];
        if (ticketDone(state, t) || ticketDead(state, t)) { q.smalls.shift(); continue; }
        if (await isGrad(k)) { markSkip(t); q.smalls.shift(); continue; }
        if (sent >= limit) break mainLoop;
        const ok = await execTicket(t);
        sent++;
        if (ok) { q.smalls.shift(); doneTotal++; }
        progressed = true; acted = true;
        if (sent < limit) await sleep(rand(minDelay, maxDelay) * 1000);
        break;
      }
      if (q.smalls.length === 0 && q.big && !ticketDone(state, q.big) && !ticketDead(state, q.big)) {
        if (await isGrad(k)) { markSkip(q.big); q.big = null; continue; }
        if (sent >= limit) break mainLoop;
        const ok = await execTicket(q.big);
        sent++;
        if (ok) { q.big = null; doneTotal++; }
        progressed = true;
        if (sent < limit) await sleep(rand(minDelay, maxDelay) * 1000);
      }
      if (doNotify && sent > 0 && sent % 500 === 0) notify(`${doneTotal} tiket beres`);
    }
    if (!progressed) break;
  }

  const c = counts();
  const hrs = ((Date.now() - t0) / 3600000).toFixed(2);
  console.log(`\n🏁 Run selesai: sent=${sent} | done=${c.done} pending=${c.pend} failed=${c.fail} | durasi ${hrs} jam`);
  log(`RUN END sent=${sent} done=${c.done} pend=${c.pend} fail=${c.fail}`);
  if (doNotify) notify(`FILL: ${c.done} done, ${c.pend} pending, ${c.fail} failed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
