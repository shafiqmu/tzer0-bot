#!/usr/bin/env node
// progress.js — status ringkas rantai tzero + self-heal restart (dipakai cron & manual).
// Kill-switch: kalau file analysis/STOP ada, TIDAK restart (buat stop sengaja).
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = '/home/ubuntu/tzer0-bot';
process.chdir(ROOT);
const A = path.join(ROOT, 'analysis');
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

const complete = done + failed + other >= 4004 && other === 0; // semua tiket terminal
const stopFlag = fs.existsSync(path.join(A, 'STOP'));
const recentLog = Math.min(
  mtimeAgeMin('logs/fill.log'),
  mtimeAgeMin('logs/distribute_0.log'),
  mtimeAgeMin('logs/distribute_1.log'),
  mtimeAgeMin('logs/distribute_2.log'),
  mtimeAgeMin('logs/distribute_3.log'),
  mtimeAgeMin('logs/launch.log')
);
const restartAgeMin = mtimeAgeMin(path.join(A, 'chain_restart_ts'));

let heal = 'ok';
if (complete) heal = 'SELESAI';
else if (stopFlag) heal = 'STOP-flag';
else if (chainAlive || fillAlive || distAlive || launchAlive) heal = 'running';
else if (missionCount < 14) heal = 'launch-belum-kelar';
else if (recentLog < 3) heal = 'recent-activity';
else if (restartAgeMin < 30) heal = 'just-restarted';
else {
  try {
    execSync(`cd ${ROOT} && setsid nohup bash scripts/finish-all.sh >> logs/finish-all.log 2>&1 < /dev/null &`, { shell: '/bin/bash' });
    fs.writeFileSync(path.join(A, 'chain_restart_ts'), String(Date.now()));
    heal = 'RESTARTED';
  } catch (e) { heal = 'restart-fail: ' + e.message; }
}

console.log(`[${new Date().toISOString()}] tzero: fill ${done}/4004 done, ${other} pending, ${failed} failed | topups ${sent} | missions ${missionCount}/14 | procs chain=${chainAlive ? 1 : 0} fill=${fillAlive ? 1 : 0} dist=${distAlive ? 1 : 0} | ${heal}`);
