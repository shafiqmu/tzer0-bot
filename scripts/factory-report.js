#!/usr/bin/env node
// factory-report.js — laporan bahasa manusia buat chat (dipanggil cron tzero-factory-watch).
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return null; } };

const cs = read('campaign_state.json');
const out = [];
if (!cs) {
  const pilot = read('factory_state.json');
  if (pilot) out.push(`🏭 Pabrik: fase pilot (mission 1) — tahap: ${pilot.step}`);
  else out.push('🏭 Pabrik: belum mulai.');
} else {
  const done = cs.missions.filter((m) => m.ok);
  const totalPts = cs.missions.reduce((a, m) => a + (Number(m.points) || 0), 0);
  const usedW = 36 + Math.min(cs.nextWindow || 0, 999) * 28; // approx
  if (cs.status === 'waiting-pilot') {
    const pilot = read('factory_state.json') || {};
    out.push(`🏭 Pabrik: nunggu mission 1 (pilot) kelar — tahap: ${pilot.step || '?'} (${pilot.name || 'Nimbus Foundry'})`);
  } else if (cs.status === 'running') {
    const cur = read(fs.existsSync(path.join(A, 'campaign_state.json')) ? 'campaign_state.json' : '') || cs;
    const mN = (cs.nextWindow || 0) + 2;
    // state mission yg sedang jalan (kalau ada)
    const stPath = `factory_m${mN}_state.json`;
    const ms = read(stPath);
    const steps = { create: 'bikin mission', early: 'backer awal masuk', wait1: 'nunggu hold 60 mnt', late: 'backer terakhir masuk (nunggu lift)', wait2: 'nunggu hold abis lift', sell: 'jual token (balikin duit)', verify: 'cek poin' };
    out.push(`🏭 Pabrik jalan: mission ${mN} (${ms && ms.name ? ms.name : '?'}) — ${ms ? (steps[ms.step] || ms.step) : 'siap-siap'}`);
    out.push(`✅ Udah kelar: ${done.length + 1} mission · 💰 Poin kekumpul ≈ ${totalPts.toLocaleString('id-ID')} · 📦 Wallet kepake ≈ ${usedW}/1000`);
    const last = done[done.length - 1];
    if (last) out.push(`↩️ Terakhir: ${last.name} (${last.ticker}) → poin ${Number(last.points || 0).toLocaleString('id-ID')} · mission ${String(last.mission || '').slice(0, 10)}…`);
  } else if (cs.status === 'done') {
    out.push(`🏆 PABRIK SELESAI SEMUA! ${cs.missions.length} mission · poin total ≈ ${totalPts.toLocaleString('id-ID')}`);
  } else if (cs.status === 'stuck') {
    out.push(`⚠️ Pabrik MACET di window ${cs.nextWindow + 1} — perlu dicek (state aman, bisa lanjut).`);
  } else if (cs.status === 'stopped') {
    out.push('🛑 Pabrik berhenti (STOP file aktif).');
  }
}
console.log(out.join('\n'));
