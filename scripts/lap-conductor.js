#!/usr/bin/env node
// lap-conductor.js — auto-chain seri panen: tunggu lap N-1 'done' → kunci GO → spawn lap N.
// Usage: node scripts/lap-conductor.js --from 5 --to 12
// Stop: file analysis/STOP, atau matikan proses ini. Idempotent (skip kalau state/lock udah ada).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const FROM = Number(arg('--from', 5));
const TO = Number(arg('--to', 12));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...x) => console.log(`[lap-conductor ${new Date().toISOString()}]`, ...x);
const rd = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

(async () => {
  say(`seri lap ${FROM} → ${TO} | nunggu...`);
  for (let L = FROM; L <= TO; L++) {
    const prevFile = path.join(A, `line_state${L - 1}.json`);
    // 1) tunggu lap sebelumnya selesai
    for (;;) {
      if (fs.existsSync(path.join(A, 'STOP'))) { say('STOP — keluar.'); return; }
      const st = rd(prevFile);
      if (st && st.status === 'done') break;
      await sleep(120000);
    }
    // 2) udah pernah jalan? skip
    const stateFile = path.join(A, `line_state${L}.json`);
    if (fs.existsSync(stateFile)) { say(`lap ${L} (state udah ada) — lanjut nunggu lap berikutnya.`); continue; }
    // 3) kunci atomik biar gak dobel sama watchdog
    const lock = path.join(A, `LAP${L}_GO.lock`);
    try { fs.writeFileSync(lock, new Date().toISOString(), { flag: 'wx' }); }
    catch (e) { say(`lock lap ${L} udah ada — skip spawn.`); continue; }
    // 4) spawn line lap L (detached)
    say(`🏁 LAP ${L - 1} TUNTAS — START LAP ${L}!`);
    const out = fs.openSync(path.join(ROOT, `logs/line${L}.log`), 'a');
    spawn('node', ['scripts/factory-line.js', '--run', `--lap${L}`], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
    await sleep(300000); // jeda 5 mnt (lap-nya sendiri yang kelar kemudian di-iterasi berikutnya)
  }
  say(`seri kelar s/d lap ${TO} — exit.`);
})();
