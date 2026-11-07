#!/usr/bin/env node
// migrate-v3.js — sekali jalan: bawa mission #2..#7 (yang dibuat pakai desain v2) ke desain v3:
//   1) top-up wallet PEMICU (backer terakhir) tiap mission ke ~0.018 buat beli sisa kurva
//   2) isi FASE A (27 backer pertama beli 0.0102; yang udah beli di-skip otomatis)
//   3) update line_state: phase 'aged' + seededTs (dari beli terakhir)
// Usage: node scripts/migrate-v3.js
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const LINE_STATE = path.join(A, 'line_state.json');
const LIST = [2, 3, 4, 5, 6, 7];

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const saveLine = (st) => { st.updatedAt = Date.now(); fs.writeFileSync(LINE_STATE, JSON.stringify(st, null, 1)); };

(async () => {
  const st = readJson(LINE_STATE);
  const missions = LIST.map((n) => st.missions.find((m) => m.n === n)).filter(Boolean);

  // --- 1) top-up wallet pemicu ---
  const spares = readJson(path.join(A, 'factory_plan.json')).filter((p) => p.role === 'spare').map((p) => p.addr.toLowerCase());
  const trigs = [];
  for (const m of missions) {
    const plan = readJson(path.join(ROOT, m.planFile));
    const backers = plan.filter((p) => p.role === 'backer').map((p) => p.addr);
    m._trigger = backers[backers.length - 1];
    trigs.push(m._trigger);
  }
  const excl = new Set(spares);
  for (const m of missions) for (const w of m.wallets) excl.add(w.toLowerCase());
  for (const t of trigs) excl.delete(t.toLowerCase()); // pemicu = target, jangan di-exclude
  fs.writeFileSync(path.join(A, 'mig_excl.txt'), [...excl].join('\n'));
  fs.writeFileSync(path.join(A, 'mig_fund.json'), JSON.stringify(trigs.map((t) => ({ addr: t, want: '0.018' })), null, 1));
  console.log('=== TOP-UP 6 wallet pemicu ke 0.018 ===');
  const fr = spawnSync('node', ['scripts/consolidate.js', '--plan', 'analysis/mig_fund.json', '--run', '--exclude', 'analysis/mig_excl.txt'], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
  process.stdout.write((fr.stdout || '') + (fr.stderr || ''));

  // --- 2) isi FASE A per mission (sequential) ---
  for (const m of missions) {
    console.log(`\n=== FASE A FILL #${m.n} (${m.name}) ===`);
    const r = spawnSync('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', m.planFile, '--state', m.stateFile, '--log', m.logFile, '--name', m.name, '--ticker', m.ticker], { cwd: ROOT, encoding: 'utf8', timeout: 2400000 });
    process.stdout.write((r.stdout || '') + (r.stderr || ''));
    const ms = (() => { try { return readJson(path.join(ROOT, m.stateFile)); } catch (e) { return null; } })();
    const st2 = readJson(LINE_STATE);
    const mm = st2.missions.find((x) => x.n === m.n);
    if (ms && ['aged', 'trigger', 'sell'].includes(ms.step)) {
      const ts = Math.max(...Object.values(ms.buys || {}).map((x) => x.ts || 0), Date.now() - 1000);
      mm.phase = 'aged'; mm.seededTs = ts; mm.mission = ms.mission;
      saveLine(st2);
      console.log(`#${m.n} → AGED ✅ (beli ${Object.keys(ms.buys).length} wallet, umur dari ${new Date(ts).toISOString().slice(11, 19)})`);
    } else {
      mm.phase = 'seeding'; saveLine(st2);
      console.log(`⚠️ #${m.n} fill gak kelar (step ${ms ? ms.step : '?'}) — biarin jalur yang ulang.`);
    }
  }
  console.log('\n=== MIGRASI v3 SELESAI (line_state udah diupdate) ===');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
