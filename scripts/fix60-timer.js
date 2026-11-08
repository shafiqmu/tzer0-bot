#!/usr/bin/env node
// fix60-timer.js — penambal sekali pakai mission #60 (Pale Trek): FASE A gagal funding (semua buy "insufficient funds").
// Loop mandiri: (1) isi ulang wallet bolong pakai consolidate retry, (2) spawn seed-child untuk beli,
// (3) begitu umur beli terakhir >= 62 mnt → funding wallet pemicu sesuai gap live → line bakal lift + sell otomatis.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stF = path.join(A, 'factory_m60_state.json');
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(RPC);
const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const say = (...x) => console.log(`[fix60 ${new Date().toISOString()}]`, ...x);

// scan /proc langsung — bebas jebakan self-match pgrep
const hasProc = (needle) => {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(needle)) return true; } catch (e) {}
  }
  return false;
};

const plan0 = readJson(path.join(A, 'line_m60_plan.json'));
const backers = plan0.filter((x) => x.role === 'backer').map((x) => x.addr);
const trig = backers[backers.length - 1];

function spawnSeed() {
  // HOLD sebentar biar crash-loop line gak nyerobot step 'phaseA' (double-buy race)
  fs.writeFileSync(path.join(A, 'HOLD'), '');
  const st = readJson(stF);
  if (st.step !== 'phaseA') { st.step = 'phaseA'; fs.writeFileSync(stF, JSON.stringify(st, null, 1)); say(`step ${st.step === 'phaseA' ? '(di-set)' : ''} → phaseA`); }
  const out = fs.openSync(path.join(ROOT, 'logs/line_m60.log'), 'a');
  spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', 'analysis/line_m60_plan.json', '--state', 'analysis/factory_m60_state.json', '--log', 'logs/line_m60.log', '--name', 'Pale Trek', '--ticker', 'PLTK'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
  setTimeout(() => { try { fs.unlinkSync(path.join(A, 'HOLD')); } catch (e) {} }, 4000);
  say('seed-child di-spawn (beli FASE A).');
}

(async () => {
  let lastRefill = 0;
  for (;;) {
    const st = readJson(stF);
    const nBuy = Object.keys(st.buys || {}).length;
    const ts = Math.max(0, ...Object.values(st.buys || {}).map((x) => x.ts || 0));
    const ageMin = ts ? (Date.now() - ts) / 60000 : 0;
    say(`status: buys ${nBuy}/27 | umur beli terakhir ${ts ? ageMin.toFixed(1) : '-'} mnt`);

    // kondisi berhenti: semua beli & cukup umur | cukup banyak & cukup umur | kepepet waktu
    if (nBuy >= 24 && ageMin >= 62) { say('siap — funding pemicu.'); break; }
    if (ageMin >= 95 && nBuy >= 20) { say('kepepet umur — funding pemicu (crew parsial).'); break; }
    if (ageMin >= 115) { say('hard-cap — funding apa adanya.'); break; }

    if (nBuy < 27 && ageMin < 62) {
      if (!hasProc('factory_m60_state')) {
        // ada yang bolong; coba isi ulang dulu (idempotent), baru lanjut beli
        if (Date.now() - lastRefill > 20 * 60 * 1000) {
          lastRefill = Date.now();
          say('wallet bolong — coba isi ulang (consolidate, idempotent)...');
          const r = spawnSync('node', ['scripts/consolidate.js', '--plan', 'analysis/fix60_plan.json', '--run', '--exclude', 'analysis/fix_excl60.txt'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
          process.stdout.write((r.stdout || '').split('\n').slice(-4).join('\n') + '\n');
        }
        say(nBuy === 0 ? 'belum ada beli — spawn seed-child awal.' : 'lanjut beli sisa — respawn seed-child.');
        spawnSeed();
      } else {
        say('seed-child masih jalan — biarin.');
      }
    }
    await sleep(60000);
  }

  // === funding pemicu ===
  const st = readJson(stF);
  const c = await lp.curve(st.mission);
  if (c.graduated) { say('kurva udah lift duluan — gak perlu funding. keluar.'); return; }
  const gap = 0.28335 - Number(ethers.formatEther(c[6]));
  const need = (gap * 1.09 + 0.004).toFixed(6);
  say(`gap ${gap.toFixed(6)} ETH → want pemicu ${need}`);

  const ls = readJson(path.join(A, 'line_state2.json'));
  const ex = new Set();
  for (const m of ls.missions) {
    if (m.n !== 60 && ['seeding', 'aged', 'trigger'].includes(m.phase)) {
      try { readJson(path.join(ROOT, m.planFile)).forEach((x) => ex.add(x.addr.toLowerCase())); } catch (e) {}
    }
  }
  plan0.forEach((x) => ex.add(x.addr.toLowerCase()));
  fs.writeFileSync(path.join(A, 'fix60trig_excl.txt'), [...ex].join('\n'));
  fs.writeFileSync(path.join(A, 'fix60trig_plan.json'), JSON.stringify([{ addr: trig, want: need }], null, 1));

  const r = spawnSync('node', ['scripts/consolidate.js', '--plan', 'analysis/fix60trig_plan.json', '--run', '--exclude', 'analysis/fix60trig_excl.txt'], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  process.stdout.write((r.stdout || '') + (r.stderr || ''));
  const bal = await p.getBalance(trig);
  say(`saldo pemicu sekarang: ${ethers.formatEther(bal)} ETH — line bakal lift + sell otomatis.`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
