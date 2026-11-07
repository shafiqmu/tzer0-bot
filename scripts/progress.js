#!/usr/bin/env node
// progress.js v4 — laporan per jam ke chat (cron tzero-chain-watchdog) + self-heal restart.
// Mencetak laporan SETIAP RUN; senyap hanya kalau STOP flag aktif / sudah selesai & pernah dilaporkan.
// v4: pisahkan "skip-graduated" (bukan error) dari gagal beneran di laporan & alarm.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/home/ubuntu/tzer0-bot';
process.chdir(ROOT);
const A = path.join(ROOT, 'analysis');
const P_STATE = path.join(A, 'progress_state.json');
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const alive = (pat) => { try { execSync(`pgrep -f ${JSON.stringify(pat)}`, { stdio: 'ignore' }); return true; } catch { return false; } };
const mtimeAgeMin = (p) => { try { return (Date.now() - fs.statSync(p).mtimeMs) / 60000; } catch { return Infinity; } };
const fmtH = (h) => (h >= 48 ? `${(h / 24).toFixed(1)} hari` : `${Math.round(h)} jam`);

// ---- data ----
const fill = readJSON(path.join(A, 'fill_state.json'), { tickets: {} });
let done = 0, failed = 0, other = 0, skipFailed = 0;
for (const t of Object.values(fill.tickets || {})) {
  if (t.status === 'done') done++;
  else if (t.status === 'failed') { failed++; if (/SKIP|GRADUATED/i.test(t.error || '')) skipFailed++; }
  else other++;
}
const started = done + failed + other;
const TOTAL = 4004;

const plan = readJSON(path.join(A, 'topup_plan_v2.json'), {});
const relays = new Set((readJSON(path.join(A, 'relays.json'), { relays: [] }).relays || []).map((r) => String(r).toLowerCase()));
let expectedTopups = 0;
for (const [a, v] of Object.entries(plan.topup || {})) { if (Number(v) > 0 && !relays.has(a.toLowerCase())) expectedTopups++; }
let sent = 0;
for (let n = 0; n < 4; n++) sent += Object.keys(readJSON(path.join(A, `distribute_state_${n}.json`), { sent: {} }).sent || {}).length;

const missions = readJSON(path.join(A, 'missions_14.json'), { missions: {} });
const missionCount = Object.keys(missions.missions || {}).filter((k) => missions.missions[k].address).length;

// ---- proses & self-heal ----
const chainAlive = alive('finish-all.sh');
const fillAlive = alive('fill-runner.js');
const distAlive = alive('distribute.js');
const launchAlive = alive('launch-creators.js');
const complete = started >= TOTAL && other === 0;
const stopFlag = fs.existsSync(path.join(A, 'STOP'));
const recentLog = Math.min(...['fill.log', 'distribute_0.log', 'distribute_1.log', 'distribute_2.log', 'distribute_3.log', 'launch.log'].map((f) => mtimeAgeMin('logs/' + f)));
const restartAgeMin = mtimeAgeMin(path.join(A, 'chain_restart_ts'));
const st = readJSON(P_STATE, { lastFailed: 0, reportedDone: false, lastDone: 0, lastSent: 0, lastTs: Date.now() });

let heal = 'ok';
if (complete) heal = 'done';
else if (stopFlag) heal = 'stop-flag';
else if (chainAlive || fillAlive || distAlive || launchAlive) heal = 'running';
else if (missionCount < 14) heal = 'launch-belum-kelar';
else if (recentLog < 3) heal = 'recent';
else if (restartAgeMin < 30) heal = 'just-restarted';
else {
  try {
    execSync(`cd ${ROOT} && setsid nohup bash scripts/finish-all.sh >> logs/finish-all.log 2>&1 < /dev/null &`, { shell: '/bin/bash' });
    fs.writeFileSync(path.join(A, 'chain_restart_ts'), String(Date.now()));
    heal = 'RESTARTED';
  } catch (e) { heal = 'restart-fail'; }
}

// ---- pesan ----
const now = Date.now();
const dtH = Math.max((now - st.lastTs) / 3.6e6, 1 / 60);
const rate = (done - st.lastDone) / dtH;
const rateS = (sent - st.lastSent) / dtH;
const tag = heal === 'RESTARTED' ? ' 🔁 baru di-restart' : heal === 'restart-fail' ? ' ⚠️ chain MATI, gagal restart!' : heal === 'just-restarted' ? ' 🔁 (baru restart)' : '';
const out = [];

if (complete) {
  if (!st.reportedDone) out.push(`✅ [tzero] SELESAI — ${TOTAL} tiket: ${done} sukses, ${failed} gagal${skipFailed ? ` (${skipFailed} skip-graduated)` : ''} · top-up ${sent}/${expectedTopups}.`);
} else if (started === 0) {
  if (sent >= expectedTopups) {
    out.push(`⏳ [tzero] Top-up kelar (${sent}/${expectedTopups}) — fill mulai bentar lagi${tag}`);
  } else if (sent === 0) {
    out.push(`📦 [tzero] Top-up: fase distribusi relay jalan (baru mulai, tercatat tiap 25 kiriman)${tag}`);
  } else {
    const parts = [`📦 [tzero] Top-up: ${sent}/${expectedTopups} wallet`];
    if (rateS > 1) { parts.push(`~${Math.round(rateS)}/jam`); parts.push(`sisa ~${fmtH((expectedTopups - sent) / rateS)}`); }
    out.push(parts.join(' · ') + ` — distribusi relay${tag}`);
  }
} else {
  const pct = (((done + failed) / TOTAL) * 100).toFixed(1);
  const etaH = rate > 0.5 ? (TOTAL - started) / rate : null;
  const parts = [`⛽ [tzero] Fill: ${done}/${TOTAL} (${pct}%)`, `gagal ${failed}${skipFailed ? ` (${skipFailed} skip-graduated)` : ''}`];
  if (rate > 0.5) { parts.push(`~${Math.round(rate)}/jam`); if (etaH != null) parts.push(`sisa ~${fmtH(etaH)}`); }
  if (sent < expectedTopups) parts.push(`topup ${sent}/${expectedTopups}`);
  out.push(parts.join(' · ') + tag);
}
const realFailed = failed - skipFailed;
const prevReal = st.lastRealFailed ?? st.lastFailed ?? 0;
if (realFailed > prevReal) out.push(`⚠️ [tzero] tiket gagal nambah (selain skip): ${prevReal} → ${realFailed}`);
if (heal === 'restart-fail' && !out.length) out.push(`⚠️ [tzero] chain MATI dan gagal restart — perlu cek manual!`);
if (stopFlag) out.length = 0;

fs.writeFileSync(P_STATE, JSON.stringify({
  lastFailed: failed,
  lastRealFailed: realFailed,
  reportedDone: complete ? true : st.reportedDone,
  lastDone: done,
  lastSent: sent,
  lastTs: now,
}));

if (out.length) console.log(out.join('\n'));
