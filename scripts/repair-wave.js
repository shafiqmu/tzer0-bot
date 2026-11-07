#!/usr/bin/env node
// repair-wave.js — dipanggil watchdog tiap jam: kalau wallet bebas cukup, panen ekor terpendek berikutnya.
// Guards: STOP file, grab jalan (pgrep), ekor abis. Senyap kalau cuma nunggu (biar gak spam).
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { ethers } = require('ethers');
const ROOT = '/home/ubuntu/tzer0-bot';
process.chdir(ROOT);
const A = path.join(ROOT, 'analysis');
const sh = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };

if (fs.existsSync(path.join(A, 'STOP'))) process.exit(0);
if (sh("pgrep -f 'node scripts/repair-grab[.]js'").length) { console.log('🦾 [wave] skip — grab masih jalan'); process.exit(0); }
if (sh("pgrep -f 'node scripts/sell-batch[.]js'").length) { console.log('🦾 [wave] skip — sweep jual jalan'); process.exit(0); }

(async () => {
  const f = JSON.parse(fs.readFileSync(path.join(A, 'fill_state.json'), 'utf8'));
  const alloc = JSON.parse(fs.readFileSync(path.join(A, 'allocator_14m.json'), 'utf8'));
  const st = fs.existsSync(path.join(A, 'repair_state.json')) ? JSON.parse(fs.readFileSync(path.join(A, 'repair_state.json'), 'utf8')) : { done: {}, skip1: {} };
  const wt = {};
  for (const k of Object.keys(alloc.missions)) alloc.missions[k].slots.forEach((s, i) => { const w = s.wallet.toLowerCase(); (wt[w] = wt[w] || []).push(k + '#' + i); });
  const status = (id) => { const t = f.tickets[id]; if (!t) return 'pending'; if (t.status === 'done') return 'done'; if (t.status === 'failed') return 'skip'; return 'pend'; };
  const free = [];
  for (const [w, ids] of Object.entries(wt)) {
    if (st.done[w] || st.skip1[w]) continue;
    const ss = ids.map(status);
    if (!ss.includes('skip')) continue;            // harus orphan
    if (ss.some((x) => x !== 'done' && x !== 'skip')) continue; // semua tiket lain terminal
    free.push(w);
  }
  const rows = JSON.parse(fs.readFileSync(path.join(A, 'liftables.json'), 'utf8')).rows;
  const p = new ethers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
  const abi = JSON.parse(fs.readFileSync(path.join(A, 'launchpad_full_abi.json'), 'utf8'));
  const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', abi, p);
  const alive = [];
  for (const r of rows) {
    try { const b = Number(await lp.progressBps(r.address)); if (b < 10000) { const sold = (b / 10000) * 793.1e6; const R = 1.073e8 / (1.073e9 - sold) - 0.1; alive.push({ address: r.address, tail: 0.28335 - R }); } } catch (e) {}
  }
  alive.sort((a, b) => a.tail - b.tail);
  if (!alive.length) {
    const ws = fs.existsSync(path.join(A, 'wave_state.json')) ? JSON.parse(fs.readFileSync(path.join(A, 'wave_state.json'), 'utf8')) : {};
    if (!ws.allDoneReported) { console.log('🦾 [wave] semua ekor udah kelar/lift — fase wave selesai'); fs.writeFileSync(path.join(A, 'wave_state.json'), JSON.stringify({ allDoneReported: true })); }
    process.exit(0);
  }
  const t = alive[0];
  const need = Math.ceil(t.tail / 0.00099) + 2;
  if (free.length < need) process.exit(0); // senyap: belum cukup wallet bebas
  const pick = free.slice(0, need);
  fs.writeFileSync(path.join(A, 'repair_plan.json'), JSON.stringify(pick.map((w) => ({ wallet: w, mission: t.address }))));
  const out = fs.openSync(path.join(ROOT, 'logs', 'repair-wave-run.log'), 'a');
  const ch = spawn('node', ['scripts/repair-grab.js', '--run', '--min-delay', '5', '--max-delay', '12'], { detached: true, stdio: ['ignore', out, out], cwd: ROOT });
  ch.unref();
  console.log(`🦾 [wave] GAS panen ekor ${t.address.slice(0, 10)}… (sisa ${t.tail.toFixed(4)} ETH, ${need} wallet bebas) — sisa bebas ${free.length - need}`);
})().catch((e) => console.error('wave err:', e.message));
