#!/usr/bin/env node
// points-scan.js — scan poin SEMUA wallet fleet → analysis/points_snapshot_N.json
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = '/home/ubuntu/tzer0-bot';

const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'wallets_full.json'), 'utf8')).map((x) => (typeof x === 'string' ? x : x.addr || x.address));

const get = (a) => new Promise((res) => {
  https.get(`https://testnet.tzer0.fun/api/points/${a}`, { timeout: 20000 }, (r) => {
    let d = '';
    r.on('data', (c) => (d += c));
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } });
  }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null); });
});

(async () => {
  const out = { asOf: new Date().toISOString(), n: w.length, results: {}, errors: 0 };
  let i = 0;
  for (const a of w) {
    const j = await get(a);
    if (j && j.status === 'ready') {
      out.results[a.toLowerCase()] = {
        total: j.total || 0,
        fuel: j.fuel || 0,
        crew: j.crew || 0,
        liftoff: j.liftoff || 0,
        pendingFuel: j.pendingFuel || 0,
      };
    } else { out.errors++; }
    if (++i % 100 === 0) console.log(`...${i}/${w.length} (err ${out.errors})`);
    await new Promise((r) => setTimeout(r, 320));
  }
  const vals = Object.values(out.results).map((x) => x.total).sort((a, b) => a - b);
  const above = vals.filter((v) => v >= 500).length;
  out.summary = {
    scanned: vals.length,
    above500: above,
    pct: +((above / vals.length) * 100).toFixed(1),
    median: vals[Math.floor(vals.length / 2)],
    min: vals[0],
    max: vals[vals.length - 1],
  };
  const f = path.join(ROOT, 'analysis', `points_snapshot_${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log('SELESAI →', f);
  console.log(JSON.stringify(out.summary));
})();
