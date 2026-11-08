// factory-report.js — laporan bahasa manusia buat chat (dipanggil cron tzero-factory-watch).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return null; } };
const AGE = 61 * 60000;

const pilot = read('factory_state.json');
const line2 = read('line_state2.json');
const line = line2 || read('line_state.json');
const LAP = line2 ? 2 : 1;
const out = [];

const pilotName = (pilot && pilot.name) || 'Nimbus Foundry';
const pilotStep = pilot ? pilot.step : '?';
const pilotDone = pilot && pilot.step === 'done';

if (!line) {
  out.push(pilotDone ? `✅ Mission 1 (${pilotName}) KELAR`
    : `🏭 Mission 1 (${pilotName}) — tahap: ${pilotStep}`);
} else {
  const missions = line.missions || [];
  const settled = missions.filter((m) => m.phase === 'settled' && m.ok);
  const aged = missions.filter((m) => m.phase === 'aged');
  const triggers = missions.filter((m) => m.phase === 'trigger');
  const seeding = missions.filter((m) => m.phase === 'seeding');
  const totalPts = settled.reduce((a, m) => a + (Number(m.points) || 0), 0) + (pilotDone ? Number(pilot.totalPoints || 0) : 0);
  const doneCount = settled.length + (pilotDone ? 1 : 0);
  const usedW = 36 + missions.reduce((a, m) => a + (m.wallets ? m.wallets.length : 0), 0);
  const lapTag = LAP > 1 ? ` LAP ${LAP}` : '';

  if (line.status === 'running') {
    out.push(`🏭 Pabrik${lapTag} jalan: ${doneCount} mission kelar · ${missions.length} udah diproduksi · 📦 wallet kepake ≈ ${usedW}/1000`);
    const bits = [];
    if (triggers.length) bits.push(`#${triggers.map((m) => m.n).join(',#')} lagi LIFT 🚀`);
    if (aged.length) bits.push(`${aged.length} mission udah matang (nunggu antrean pemicu)`);
    if (seeding.length) bits.push(`#${seeding.map((m) => m.n).join(',#')} baru diproduksi`);
    out.push('⏳ ' + (bits.join(' · ') || 'siap-siap'));
    if (triggers.length) {
      out.push('⏰ Ada mission lagi disamber (LIFT) sekarang...');
    } else if (aged.length) {
      const next = aged.slice().sort((a, b) => a.seededTs - b.seededTs)[0];
      const mins = Math.max(0, Math.round((next.seededTs + AGE - Date.now()) / 60000));
      out.push(`⏰ Lift berikutnya: #${next.n} (${next.name}) ±${mins} mnt lagi`);
    }
    const last = settled[settled.length - 1];
    if (last) out.push(`↩️ Terakhir kelar: ${last.name} (${last.ticker})${last.points ? ' → poin ' + Number(last.points).toLocaleString('id-ID') : ''}`);
  } else if (line.status === 'done') {
    // estimasi on-chain: crew 150/beli + liftoff 500/creator + fuel ±10/beli
    let buys = 0;
    for (const m of missions) { try { const ms = read(('' + m.stateFile).split('/').pop()); if (ms && ms.buys) buys += Object.keys(ms.buys).length; } catch (e) {} }
    try { const pil = read('factory_state.json'); if (pil && pil.buys) buys += Object.keys(pil.buys).length; } catch (e) {}
    const est = buys * 150 + (doneCount) * 500 + Math.round(buys * 10);
    out.push(`🏆 PABRIK${lapTag} KELAR SEMUA! ${doneCount} mission total · estimasi ±${est.toLocaleString('id-ID')} poin (on-chain; server poin mereka masih ngadat)`);
  } else if (line.status === 'stuck') {
    out.push(`⚠️ Jalur${lapTag} macet — perlu dicek (state aman, bisa lanjut). Cek logs/line2.log`);
  } else if (line.status === 'stopped') {
    out.push(`🛑 Jalur${lapTag} berhenti (STOP aktif).`);
  } else {
    out.push(`🏭 Jalur${lapTag} status: ${line.status} · ${doneCount} mission kelar`);
  }
}
console.log(out.join('\n'));
