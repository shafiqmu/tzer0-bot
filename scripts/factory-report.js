#!/usr/bin/env node
// factory-report.js — laporan bahasa manusia buat chat (dipanggil cron tzero-factory-watch).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return null; } };
const AGE = 61 * 60000;

const pilot = read('factory_state.json');
const line = read('line_state.json');
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

  if (line.status === 'running') {
    out.push(`🏭 Pabrik jalan: ${doneCount}/35 mission kelar · 📦 wallet kepake ≈ ${usedW}/1000`);
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
    out.push(`🏆 PABRIK KELAR SEMUA! ${doneCount} mission · poin total ≈ ${totalPts.toLocaleString('id-ID')}`);
  } else if (line.status === 'stuck') {
    out.push('⚠️ Jalur macet — perlu dicek (state aman, bisa lanjut). Cek logs/line.log');
  } else if (line.status === 'stopped') {
    out.push('🛑 Jalur berhenti (STOP aktif).');
  } else {
    out.push(`🏭 Jalur status: ${line.status} · ${doneCount} mission kelar`);
  }
}
console.log(out.join('\n'));
