#!/usr/bin/env node
// factory-report.js — laporan bahasa manusia buat chat (dipanggil cron tzero-factory-watch).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return null; } };

const pilot = read('factory_state.json');
const line = read('line_state.json');
const out = [];

const pilotName = (pilot && pilot.name) || 'Nimbus Foundry';
const pilotStep = pilot ? pilot.step : '?';
const pilotDone = pilot && pilot.step === 'done';

if (!line) {
  out.push(pilotDone ? `✅ Mission 1 (${pilotName}) KELAR — poin peserta ≈ ${pilot.totalPoints || '?'}`
    : `🏭 Mission 1 (${pilotName}) — tahap: ${pilotStep}`);
} else {
  const missions = line.missions || [];
  const settled = missions.filter((m) => m.phase === 'settled' && m.ok);
  const seeded = missions.filter((m) => m.phase === 'seeded');
  const bursting = missions.filter((m) => m.phase === 'burst');
  const seeding = missions.find((m) => m.phase === 'seeding');
  const totalPts = settled.reduce((a, m) => a + (Number(m.points) || 0), 0) + (pilotDone ? Number(pilot.totalPoints || 0) : 0);
  const doneCount = settled.length + (pilotDone ? 1 : 0);
  const usedW = 36 + missions.reduce((a, m) => a + (m.wallets ? m.wallets.length : 0), 0);

  if (line.status === 'waiting-pilot') {
    out.push(`🏭 Jalur pipa nyala — nunggu mission 1 (${pilotName}) lift dulu (sekarang: ${pilotStep})`);
  } else if (line.status === 'running') {
    out.push(`🏭 Pabrik cepat jalan: ${doneCount}/35 mission kelar · ⭐ poin ≈ ${totalPts.toLocaleString('id-ID')} · 📦 wallet kepake ≈ ${usedW}/1000`);
    const bits = [];
    if (bursting.length) bits.push(`#${bursting.map((m) => m.n).join(',#')} lagi DIISI PENUH 🚀`);
    if (seeded.length) bits.push(`${seeded.length} mission lagi "dipanasin" (umur 60 mnt)`);
    if (seeding) bits.push(`#${seeding.n} (${seeding.name}) baru diproduksi`);
    out.push('⏳ ' + (bits.join(' · ') || 'siap-siap'));
    const last = settled[settled.length - 1];
    if (last) out.push(`↩️ Terakhir kelar: ${last.name} (${last.ticker}) → poin ${Number(last.points || 0).toLocaleString('id-ID')}`);
  } else if (line.status === 'done') {
    out.push(`🏆 PABRIK KELAR SEMUA! ${doneCount} mission · poin total ≈ ${totalPts.toLocaleString('id-ID')}`);
  } else if (line.status === 'stuck') {
    out.push(`⚠️ Jalur macet — perlu dicek (state aman, bisa lanjut). Cek logs/line.log`);
  } else if (line.status === 'stopped') {
    out.push('🛑 Jalur berhenti (STOP aktif).');
  } else {
    out.push(`🏭 Jalur status: ${line.status} · ${doneCount} mission kelar`);
  }
}
console.log(out.join('\n'));
