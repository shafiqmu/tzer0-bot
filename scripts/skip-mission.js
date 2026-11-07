#!/usr/bin/env node
// skip-mission.js — tandai semua tiket PENDING sebuah mission sebagai failed (SKIP total).
// Pakai kalau mission mentok/closed (buy selalu revert) biar runner gak buang waktu.
//   node scripts/skip-mission.js m11 "alasan..."
// Aman diulang; yang sudah done/failed dibiarkan. Sinkron progress_state.lastFailed.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const mission = process.argv[2];
const reason = process.argv[3] || 'skip';
if (!mission) { console.error('pakai: node scripts/skip-mission.js m11 "alasan"'); process.exit(1); }
const state = JSON.parse(fs.readFileSync(path.join(A, 'fill_state.json'), 'utf8'));
const alloc = JSON.parse(fs.readFileSync(path.join(A, 'allocator_14m.json'), 'utf8'));
if (!alloc.missions[mission]) { console.error('mission gak ada di allocator:', mission); process.exit(1); }
const slots = alloc.missions[mission].slots;
let marked = 0, kept = 0;
slots.forEach((s, idx) => {
  const id = `${mission}#${idx}`;
  const cur = state.tickets[id];
  if (cur && (cur.status === 'done' || cur.status === 'failed')) { kept++; return; }
  state.tickets[id] = { status: 'failed', attempts: 3, error: `SKIP: ${reason}`, wallet: s.wallet, ts: Date.now() };
  marked++;
});
fs.writeFileSync(path.join(A, 'fill_state.json'), JSON.stringify(state));
let fail = 0, done = 0;
for (const v of Object.values(state.tickets)) { if (v.status === 'failed') fail++; else if (v.status === 'done') done++; }
try {
  const ps = path.join(A, 'progress_state.json');
  const st = JSON.parse(fs.readFileSync(ps, 'utf8'));
  st.lastFailed = fail; st.lastDone = done; st.lastTs = Date.now();
  fs.writeFileSync(ps, JSON.stringify(st));
} catch (e) {}
console.log(`✅ skip-mission ${mission}: ditandai failed=${marked}, dibiarkan(done/failed)=${kept}`);
console.log(`   total sekarang: done=${done} failed=${fail}`);
