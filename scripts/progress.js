#!/usr/bin/env node
// progress.js — watchdog rantai tzero: self-heal restart + print HANYA kalau ada kejadian.
// Dipakai cron no_agent: stdout kosong = senyap; ada isi = ping ke chat.
// Kill-switch: file analysis/STOP ada → tidak akan restart (buat stop sengaja).
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

const fill = readJSON(path.join(A, 'fill_state.json'), { tickets: {} });
let done = 0, failed = 0, other = 0;
for (const t of Object.values(fill.tickets || {})) {
  if (t.status === 'done') done++; else if (t.status === 'failed') failed++; else other++;
}
let sent = 0;
for (let n = 0; n < 4; n++) sent += Object.keys(readJSON(path.join(A, `distribute_state_${n}.json`), { sent: {} }).sent || {}).length;

const missions = readJSON(path.join(A, 'missions_14.json'), { missions: {} });
const missionCount = Object.keys(missions.missions || {}).filter((k) => missions.missions[k].address).length;

const chainAlive = alive('finish-all.sh');
const fillAlive = alive('fill-runner.js');
const distAlive = alive('distribute.js');
const launchAlive = alive('launch-creators.js');

const complete = done + failed + other >= 4004 && other === 0;
const stopFlag = fs.existsSync(path.join(A, 'STOP'));
const recentLog = Math.min(...['fill.log', 'distribute_0.log', 'distribute_1.log', 'distribute_2.log', 'distribute_3.log', 'launch.log'].map((f) => mtimeAgeMin('logs/' + f)));
const restartAgeMin = mtimeAgeMin(path.join(A, 'chain_restart_ts'));

const st = readJSON(P_STATE, { reported: 0, lastFailed: 0, reportedDone: false });

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

const out = [];
if (heal === 'RESTARTED') out.push(`🔁 [tzero] chain mati — di-restart otomatis. fill ${done}/4004, ${failed} failed, topups ${sent}.`);
if (heal === 'restart-fail') out.push(`⚠️ [tzero] chain mati & GAGAL restart otomatis — perlu cek manual. fill ${done}/4004, ${failed} failed.`);
if (heal === 'launch-belum-kelar' && done + other + failed === 0) out.push(`⚠️ [tzero] fill belum bisa jalan: mission baru ${missionCount}/14.`);
if (complete && !st.reportedDone) out.push(`✅ [tzero] SEMUA KELAR: 4004 tiket (${done} done, ${failed} failed) | topups ${sent}.`);
if (failed > st.lastFailed) out.push(`⚠️ [tzero] tiket gagal nambah: ${st.lastFailed} → ${failed} (done ${done}/4004).`);

const milestone = Math.floor(done / 1000) * 1000;
if (!out.length && milestone > st.reported && milestone > 0) {
  out.push(`📊 [tzero] progress: ${done}/4004 tiket done (${failed} failed) — jalan normal.`);
}

fs.writeFileSync(P_STATE, JSON.stringify({
  reported: Math.max(st.reported, milestone),
  lastFailed: failed,
  reportedDone: complete ? true : st.reportedDone,
}));

if (out.length) console.log(out.join('\n'));
