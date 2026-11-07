#!/usr/bin/env node
// repair-funding.js — top-up ulang wallet mission yang transfer-nya gagal dulu (sebelum burst).
// Rebuild exclude segar (lindungi semua wallet mission aktif lain) lalu rerun consolidate per mission.
// Usage: node scripts/repair-funding.js --missions 2,3,4,5,6 [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const RUN = !argv.includes('--dry');
const args = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const list = (args('--missions', '') || '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
const st = JSON.parse(fs.readFileSync(path.join(A, 'line_state.json'), 'utf8'));
const spares = JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8')).filter((p) => p.role === 'spare').map((p) => p.addr.toLowerCase());

(async () => {
  for (const n of list) {
    const m = st.missions.find((x) => x.n === n);
    if (!m) { console.log(`m${n}: gak ada di state — skip`); continue; }
    if (!['seeded', 'burst'].includes(m.phase)) { console.log(`m${n}: fase ${m.phase} — skip`); continue; }
    const excl = new Set(spares);
    for (const mm of st.missions) { if (mm.n !== n && ['seeding', 'seeded', 'burst'].includes(mm.phase)) for (const w of (mm.wallets || [])) excl.add(w.toLowerCase()); }
    const exF = `analysis/repair_excl_m${n}.txt`;
    fs.writeFileSync(path.join(ROOT, exF), [...excl].join('\n'));
    console.log(`=== repair m${n} (${m.name}) | exclude ${excl.size} wallet ===`);
    if (!RUN) { console.log('(dry)'); continue; }
    const r = spawnSync('node', ['scripts/consolidate.js', '--plan', m.fundFile, '--run', '--exclude', exF], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
    process.stdout.write((r.stdout || '') + (r.stderr || ''));
  }
  console.log('REPAIR DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
