#!/usr/bin/env node
// fill85.js — isi sisa kurva #85 pakai spare wallet (jangan sampai lewat cap / auto-graduate dini).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
const LPAD = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';
const lp = new ethers.Contract(LPAD, ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)', 'function buy(address,uint256) payable'], p);
const LIFT_NET = 0.28335;
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
function loadBareKeys(file) { const out = []; for (const line of fs.readFileSync(file, 'utf8').split('\n')) { const t = line.trim(); if (/^0x[a-fA-F0-9]{64}$/.test(t)) out.push(t); } return out; }

(async () => {
  const st = readJson(path.join(ROOT, 'analysis/factory_m85_state.json'));
  const pl = readJson(path.join(ROOT, 'analysis/line_m85_plan.json'));
  const c = await lp.curve(st.mission);
  if (c[2]) { console.log('kurva udah graduated — batal.'); return; }
  const real = Number(ethers.formatEther(c[6]));
  const headroom = LIFT_NET - real;
  console.log(`real ${real.toFixed(5)} | headroom ${headroom.toFixed(5)}`);
  const budget = Math.max(0, headroom - 0.006); // sisain ≥0.006 net buat pemicu nanti
  console.log(`budget filler (net) ${budget.toFixed(5)}`);
  if (budget < 0.006) { console.log('headroom kurang — skip.'); return; }

  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const kmap = new Map();
  for (const k of keys) { const w = new ethers.Wallet(k); kmap.set(w.address.toLowerCase(), k); }
  const bought = new Set(Object.keys(st.buys || {}).map((a) => a.toLowerCase()));
  // kandidat: spare di plan yang belum beli & saldo cukup
  const cands = [];
  for (const x of pl) {
    const a = x.addr.toLowerCase();
    if (bought.has(a)) continue;
    const k = kmap.get(a); if (!k) continue;
    const bal = Number(ethers.formatEther(await p.getBalance(a)));
    if (bal >= 0.0118) cands.push([a, k, bal]);
  }
  console.log(`kandidat spare armed: ${cands.length}`);
  let spent = 0, ok = 0;
  for (const [a, k, bal] of cands) {
    if (spent + 0.0114 * 0.97 > budget + 0.0001) break;
    try {
      const w = new ethers.Wallet(k, p);
      const tx = await lp.connect(w).buy(st.mission, 0, { value: ethers.parseEther('0.0114'), gasLimit: 3000000n });
      await tx.wait();
      spent += 0.0114 * 0.97; ok++;
      console.log(`✓ ${a.slice(0, 10)} beli 0.0114 (net≈+${(0.0114 * 0.97).toFixed(5)}) tx ${tx.hash.slice(0, 12)}`);
    } catch (e) { console.log(`✗ ${a.slice(0, 10)}: ${(e.shortMessage || e.message).slice(0, 70)}`); }
  }
  const c2 = await lp.curve(st.mission);
  const real2 = Number(ethers.formatEther(c2[6]));
  console.log(`KELAR: ${ok} filler | real ${real2.toFixed(5)} | fill ${(real2 / LIFT_NET * 100).toFixed(1)}% | graduated: ${c2[2]}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
