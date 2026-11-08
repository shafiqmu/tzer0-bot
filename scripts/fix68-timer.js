#!/usr/bin/env node
// fix68-timer.js — redo mission #68 (River Antenna): FASE A kosong (funding kering pas produksi).
// Sama pola dengan fix60-timer: refill berkala → seed beli → tunggu umur ≥62 mnt → funding pemicu → line lift+sell.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stF = path.join(A, 'factory_m68_state.json');
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(RPC);
const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const say = (...x) => console.log(`[fix68 ${new Date().toISOString()}]`, ...x);

const hasProc = (...needles) => {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (needles.every((n) => cm.includes(n))) return true; } catch (e) {}
  }
  return false;
};

const plan0 = readJson(path.join(A, 'line_m68_plan.json'));
const backers = plan0.filter((x) => x.role === 'backer').map((x) => x.addr);
const trig = backers[backers.length - 1];

function spawnSeed() {
  // matiin dulu crash-loop trigger-child #68 (biar gak rebutan state; child kita yg --phase seed gak kesentuh)
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cm.includes('--phase trigger') && cm.includes('line_m68_plan')) { process.kill(Number(pid), 'SIGTERM'); say(`kill trigger-child ${pid}`); }
    } catch (e) {}
  }
  fs.writeFileSync(path.join(A, 'HOLD'), '');
  const st = readJson(stF);
  if (st.step !== 'phaseA') { st.step = 'phaseA'; fs.writeFileSync(stF, JSON.stringify(st, null, 1)); say('step → phaseA'); }
  const out = fs.openSync(path.join(ROOT, 'logs/line_m68.log'), 'a');
  spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', 'analysis/line_m68_plan.json', '--state', 'analysis/factory_m68_state.json', '--log', 'logs/line_m68.log', '--name', 'River Antenna', '--ticker', 'RVAN'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  setTimeout(() => { try { fs.unlinkSync(path.join(A, 'HOLD')); } catch (e) {} }, 4000);
  say('seed-child di-spawn (beli FASE A).');
}

(async () => {
  let lastRefill = 0;
  let lastSeedSpawn = 0;
  for (;;) {
    const st = readJson(stF);
    const nBuy = Object.keys(st.buys || {}).length;
    const ts = Math.max(0, ...Object.values(st.buys || {}).map((x) => x.ts || 0));
    const ageMin = ts ? (Date.now() - ts) / 60000 : 0;
    say(`status: buys ${nBuy}/27 | umur beli terakhir ${ts ? ageMin.toFixed(1) : '-'} mnt`);

    if (nBuy >= 24 && ageMin >= 62) { say('siap — funding pemicu.'); break; }
    if (ageMin >= 95 && nBuy >= 20) { say('kepepet umur — funding pemicu (crew parsial).'); break; }
    if (ageMin >= 115) { say('hard-cap — funding apa adanya.'); break; }

    if (nBuy < 27 && ageMin < 62) {
      if (hasProc('--phase seed', 'line_m68_plan')) { say('seed-child kita masih jalan — biarin.'); }
      else if (Date.now() - lastSeedSpawn > 3 * 60000) {
        if (Date.now() - lastRefill > 20 * 60 * 1000) {
          lastRefill = Date.now();
          say('wallet bolong — coba isi ulang (consolidate, idempotent)...');
          const r = spawnSync('node', ['scripts/consolidate.js', '--plan', 'analysis/fix68_plan.json', '--run', '--exclude', 'analysis/fix68_excl.txt'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
          process.stdout.write((r.stdout || '').split('\n').slice(-4).join('\n') + '\n');
        }
        lastSeedSpawn = Date.now();
        say(nBuy === 0 ? 'belum ada beli — spawn seed-child awal.' : 'lanjut beli sisa — respawn seed-child.');
        spawnSeed();
      } else say('cooldown seed 3 mnt.');
    }
    await sleep(60000);
  }

  // funding pemicu
  const st = readJson(stF);
  const c = await lp.curve(st.mission);
  if (c.graduated) { say('kurva udah lift duluan — gak perlu funding. keluar.'); return; }
  const gap = 0.28335 - Number(ethers.formatEther(c[6]));
  const need = (gap * 1.09 + 0.004).toFixed(6);
  say(`gap ${gap.toFixed(6)} ETH → want pemicu ${need}`);

  const ex = new Set();
  try { readJson(path.join(A, 'factory_plan.json')).filter((x) => x.role === 'spare').forEach((x) => ex.add(x.addr.toLowerCase())); } catch (e) {}
  plan0.forEach((x) => ex.add(x.addr.toLowerCase()));
  fs.writeFileSync(path.join(A, 'fix68trig_excl.txt'), [...ex].join('\n'));
  fs.writeFileSync(path.join(A, 'fix68trig_plan.json'), JSON.stringify([{ addr: trig, want: need }], null, 1));

  const r = spawnSync('node', ['scripts/consolidate.js', '--plan', 'analysis/fix68trig_plan.json', '--run', '--exclude', 'analysis/fix68trig_excl.txt'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
  const bal = await p.getBalance(trig);
  say(`saldo pemicu sekarang: ${ethers.formatEther(bal)} ETH — line bakal lift + sell otomatis.`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
