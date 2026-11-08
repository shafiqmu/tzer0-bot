#!/usr/bin/env node
// lap4-waiter.js — tunggu lap 3 'done' trus start LAP 4 otomatis (sekali saja, kunci atomik).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...x) => console.log(`[lap4-waiter ${new Date().toISOString()}]`, ...x);
(async () => {
  const deadline = Date.now() + 10 * 60 * 60 * 1000; // maks 10 jam
  for (;;) {
    let st = null;
    try { st = JSON.parse(fs.readFileSync(path.join(A, 'line_state3.json'), 'utf8')); } catch (e) {}
    if (fs.existsSync(path.join(A, 'line_state4.json'))) { say('state4 udah ada — ada yang start duluan. keluar.'); return; }
    if (st && st.status === 'done') {
      try { fs.writeFileSync(path.join(A, 'LAP4_GO.lock'), String(process.pid), { flag: 'wx' }); }
      catch (e) { say('kunci udah dipegang proses lain — keluar.'); return; }
      say('🏁 LAP 3 TUNTAS — start LAP 4!');
      const out = fs.openSync(path.join(ROOT, 'logs/line4.log'), 'a');
      spawn('node', ['scripts/factory-line.js', '--run', '--lap4'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
      return;
    }
    say(`nunggu... lap3 status: ${st ? st.status : '?'}`);
    if (Date.now() > deadline) { say('deadline 10 jam — keluar (watchdog backstop).'); return; }
    await sleep(120000);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
