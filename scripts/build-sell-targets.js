#!/usr/bin/env node
// build-sell-targets.js — bangun daftar target jual pasca-lift (fase loop daur-ulang).
// Sumber bukti pegang token: fill_state (tiket sprint 'done') + repair_state (beli repair).
// Output: analysis/sell_targets.json  [{wallet, mission}]
// Usage: node scripts/build-sell-targets.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return d; } };

const missions14 = rd('missions_14.json', { missions: {} });
const fill = rd('fill_state.json', { tickets: {} });
const alloc = rd('allocator_14m.json', { missions: {} });
const rs = rd('repair_state.json', { done: {} });

const targets = new Map(); // key wallet|mission -> {wallet, mission}
const addT = (wallet, mission) => {
  if (!wallet || !mission) return;
  const key = wallet.toLowerCase() + '|' + String(mission).toLowerCase();
  if (!targets.has(key)) targets.set(key, { wallet, mission });
};

// 1) tiket sprint yg sukses (done) → wallet pegang token mission itu
for (const m of Object.keys(alloc.missions || {})) {
  const slots = (alloc.missions[m] || {}).slots || [];
  for (let i = 0; i < slots.length; i++) {
    const t = fill.tickets[m + '#' + i];
    if (t && t.status === 'done') addT(slots[i].wallet, missions14.missions[m] ? missions14.missions[m].address : null);
  }
}
// 2) beli repair (repair_state.done) — nilai bisa string (mission) atau objek
for (const [wallet, v] of Object.entries(rs.done || {})) {
  if (typeof v === 'string') addT(wallet, v);
  else if (v && typeof v === 'object') addT(v.wallet || wallet, v.mission || v.address);
}
const list = Array.from(targets.values());
fs.writeFileSync(path.join(A, 'sell_targets.json'), JSON.stringify(list, null, 0));
console.log('sell_targets:', list.length, 'target (wallet×mission)');
