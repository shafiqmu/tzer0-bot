#!/usr/bin/env node
// stage-trig79.js — pemicu #79: transfer gap ke wallet pemicu TEPAT di detik hold 60.1 mnt (balapan sweep).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const say = (...x) => console.log(`[stage79 ${new Date().toISOString()}]`, ...x);
function loadBareKeys(file) { const out = []; for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const t = line.trim(); if (/^0x[a-fA-F0-9]{64}$/.test(t)) out.push(t); } return out; }

(async () => {
  const st = readJson(path.join(A, 'factory_m79_state.json'));
  const pl = readJson(path.join(A, 'line_m79_plan.json'));
  const trig = pl.filter((x) => x.role === 'backer').pop().addr;
  const ts = Math.max(0, ...Object.values(st.buys || {}).map((x) => x.ts || 0));
  const first = Math.min(...Object.values(st.buys || {}).map((x) => x.ts || Infinity));
  const spread = ((ts - first) / 60000).toFixed(2);
  const gate = ts + 60.10 * 60000;
  const wait = gate - Date.now();
  say(`spread beli ${spread}m | gate dalam ${(wait / 60000).toFixed(2)} mnt`);
  if (wait > 4.5 * 60000) { await sleep(wait - 4.5 * 60000); }
  const c0 = await lp.curve(st.mission);
  if (c0[2]) { say('kurva udah graduated (sweep menang) — keluar.'); return; }
  const real0 = Number(ethers.formatEther(c0[6]));
  const want0 = ((0.28335 - real0) * 1.12) / 0.99 + 0.0015;
  const bal0 = Number(ethers.formatEther(await p.getBalance(trig)));
  say(`pre-scan: want ${want0.toFixed(5)} | trig ${bal0.toFixed(5)}`);
  const protect = new Set(fs.readFileSync(path.join(A, 'fixl3_sweep_excl.txt'), 'utf8').split('\n').filter(Boolean));
  const all = readJson(path.join(A, 'wallets_full.json'));
  const donors = [];
  for (const x of all) { const a = (x.addr || x).toLowerCase(); if (protect.has(a)) continue; const b = Number(ethers.formatEther(await p.getBalance(a))); if (b >= 0.004) donors.push([a, b]); }
  donors.sort((x, y) => y[1] - x[1]);
  say(`donor: ${donors.length} (total ${donors.reduce((s, x) => s + x[1], 0).toFixed(4)})`);
  const wait2 = gate + 2000 - Date.now();
  if (wait2 > 0) await sleep(wait2);
  const c = await lp.curve(st.mission);
  if (c[2]) { say('kurva udah graduated — keluar.'); return; }
  const real = Number(ethers.formatEther(c[6]));
  const want = ((0.28335 - real) * 1.12) / 0.99 + 0.0015;
  const bal = Number(ethers.formatEther(await p.getBalance(trig)));
  const need = want + 0.0003 - bal;
  say(`GATE! want ${want.toFixed(5)} | trig ${bal.toFixed(5)} | butuh ${need.toFixed(5)}`);
  if (need <= 0.0005) { say('udah cukup — keluar.'); return; }
  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const kmap = new Map();
  for (const k of keys) { const w = new ethers.Wallet(k); kmap.set(w.address.toLowerCase(), k); }
  let collected = 0, sent = 0;
  for (const [a, b] of donors) {
    if (collected >= need) break;
    const k = kmap.get(a); if (!k) continue;
    const send = Math.min(b - 0.0008, need - collected);
    if (send <= 0.0002) continue;
    try {
      const w = new ethers.Wallet(k, p);
      const tx = await w.sendTransaction({ to: trig, value: ethers.parseEther(send.toFixed(9)) });
      await tx.wait();
      collected += send; sent++;
      say(`  ✓ ${a.slice(0, 10)} → ${send.toFixed(5)} (${collected.toFixed(5)}/${need.toFixed(5)})`);
    } catch (e) { say(`  ✗ ${a.slice(0, 10)}: ${(e.shortMessage || e.message).slice(0, 70)}`); }
  }
  const bal2 = Number(ethers.formatEther(await p.getBalance(trig)));
  say(`KELAR: ${sent} tx | saldo trig ${bal2.toFixed(5)} (butuh ${want.toFixed(5)}) ${bal2 >= want ? '✅ SIAP LIFT' : '⚠️ KURANG'}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
