#!/usr/bin/env node
// fix-timer.js --n <mission> [--delay <menit>] — penambal mission nyangkut (kas kering pas produksi):
// refill berkala → seed beli → tunggu umur ≥62 mnt → funding pemicu → line auto lift + sell.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1]);
const DELAY = argv.includes('--delay') ? Number(argv[argv.indexOf('--delay') + 1]) : 0;
if (!N) { console.error('butuh --n <mission>'); process.exit(1); }
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(RPC);
const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const say = (...x) => console.log(`[fix${N} ${new Date().toISOString()}]`, ...x);

const stF = path.join(A, `factory_m${N}_state.json`);
const planF = `analysis/line_m${N}_plan.json`;
const logF = `logs/line_m${N}.log`;

const hasProc = (...needles) => {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (needles.every((n) => cm.includes(n))) return true; } catch (e) {}
  }
  return false;
};

const s3 = readJson(path.join(A, 'line_state3.json'));
const mentry = (s3.missions || []).find((x) => x.n === N) || {};
const NAME = mentry.name || `M${N}`;
const TICKER = mentry.ticker || `M${N}`;
const plan0 = readJson(path.join(ROOT, planF));
const backers = plan0.filter((x) => x.role === 'backer').map((x) => x.addr);
const trig = backers[backers.length - 1];

function exclSet() {
  const ex = new Set();
  try { readJson(path.join(A, 'factory_plan.json')).filter((x) => x.role === 'spare').forEach((x) => ex.add(x.addr.toLowerCase())); } catch (e) {}
  for (const m of s3.missions || []) if (['aged', 'trigger', 'seeding'].includes(m.phase)) for (const w of m.wallets) ex.add(w.toLowerCase());
  return ex;
}

function spawnSeed() {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cm.includes('--phase trigger') && cm.includes(`line_m${N}_plan`)) { process.kill(Number(pid), 'SIGTERM'); say(`kill trigger-child ${pid}`); }
    } catch (e) {}
  }
  fs.writeFileSync(path.join(A, 'HOLD'), '');
  const st = readJson(stF);
  if (st.step !== 'phaseA') { st.step = 'phaseA'; fs.writeFileSync(stF, JSON.stringify(st, null, 1)); say('step → phaseA'); }
  const out = fs.openSync(path.join(ROOT, logF), 'a');
  spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', planF, '--state', `analysis/factory_m${N}_state.json`, '--log', logF, '--name', NAME, '--ticker', TICKER], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  setTimeout(() => { try { fs.unlinkSync(path.join(A, 'HOLD')); } catch (e) {} }, 4000);
  say('seed-child di-spawn (beli fase A).');
}

(async () => {
  if (DELAY > 0) { say(`delay start ${DELAY} mnt...`); await sleep(DELAY * 60000); }
  let lastRefill = 0, lastSeedSpawn = 0;
  for (;;) {
    const st = readJson(stF);
    const nBuy = Object.keys(st.buys || {}).length;
    const ts = Math.max(0, ...Object.values(st.buys || {}).map((x) => x.ts || 0));
    const ageMin = ts ? (Date.now() - ts) / 60000 : 0;
    say(`status: buys ${nBuy}/27 | umur ${ts ? ageMin.toFixed(1) : '-'} mnt`);
    if (nBuy >= 24 && ageMin >= 62) { say('siap — funding pemicu.'); break; }
    if (ageMin >= 95 && nBuy >= 20) { say('kepepet umur — funding pemicu (crew parsial).'); break; }
    if (ageMin >= 115) { say('hard-cap — funding apa adanya.'); break; }
    if (nBuy < 27 && ageMin < 62) {
      if (hasProc('--phase seed', `line_m${N}_plan`)) { say('seed-child kita masih jalan — biarin.'); }
      else {
        if (Date.now() - lastRefill > 20 * 60000) {
          lastRefill = Date.now();
          say('coba isi ulang (consolidate, idempotent)...');
          const fund = readJson(path.join(A, `line_m${N}_fund.json`));
          const trigLc = trig.toLowerCase();
          const rp = fund.filter((x) => x.addr.toLowerCase() !== trigLc);
          const need = rp.reduce((a, x) => a + Number(x.want), 0);
          const planPath = path.join(A, `fix${N}_refill_plan.json`);
          const exclPath = path.join(A, `fix${N}_refill_excl.txt`);
          fs.writeFileSync(planPath, JSON.stringify(rp, null, 1));
          fs.writeFileSync(exclPath, [...exclSet()].join('\n'));
          const r = spawnSync('node', ['scripts/consolidate.js', '--plan', planPath, '--run', '--exclude', exclPath], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
          const out = (r.stdout || '') + (r.stderr || '');
          const mv = /pindah ≈ ([\d.]+) ETH/.exec(out);
          const moved = mv ? Number(mv[1]) : 0;
          say(`refill: pindah ${moved.toFixed(4)} / butuh ${need.toFixed(4)} ETH ${moved >= 0.9 * need ? '✅' : '(kurang — balik lagi nanti)'}`);
        }
        if (Date.now() - lastSeedSpawn > 8 * 60000) { lastSeedSpawn = Date.now(); spawnSeed(); }
      }
    }
    await sleep(60000);
  }
  // ---- funding pemicu ----
  const st = readJson(stF);
  const c = await lp.curve(st.mission);
  if (c[2]) { say('kurva udah lift duluan — gak perlu funding. keluar.'); return; }
  const real = Number(ethers.formatEther(c[6]));
  const want = ((0.28335 - real) * 1.12) / 0.99 + 0.0015;
  say(`gap sisa → want pemicu ${want.toFixed(5)}`);
  const planPath = path.join(A, `fix${N}_trig_plan.json`);
  const exclPath = path.join(A, `fix${N}_trig_excl.txt`);
  fs.writeFileSync(planPath, JSON.stringify([{ addr: trig, want: want.toFixed(6) }], null, 1));
  fs.writeFileSync(exclPath, [...exclSet()].join('\n'));
  let ok = false;
  for (let t = 1; t <= 10 && !ok; t++) {
    const r = spawnSync('node', ['scripts/consolidate.js', '--plan', planPath, '--run', '--exclude', exclPath], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const mv = /pindah ≈ ([\d.]+) ETH/.exec(out);
    const moved = mv ? Number(mv[1]) : 0;
    say(`fund pemicu coba ${t}: pindah ${moved.toFixed(4)} / butuh ${want.toFixed(4)}`);
    if (moved >= 0.9 * want) ok = true; else await sleep(120000);
  }
  const bal = await p.getBalance(trig);
  say(`saldo pemicu: ${ethers.formatEther(bal).slice(0, 10)} ETH — line bakal lift + sell otomatis. ${ok ? '✅' : '⚠️ (parsial, cek lagi nanti)'}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
