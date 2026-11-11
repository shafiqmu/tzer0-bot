#!/usr/bin/env node
// points-retry.js v2 — isi wallet yang belum kebaca (sabar nunggu API 'warming' → 'ready')
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function raw(a) {
  return new Promise((res) => {
    https.get({ hostname: 'testnet.tzer0.fun', path: '/api/points/' + a, headers: UA, timeout: 25000 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } });
    }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null); });
  });
}
// return: {ready:true,data} | {warming:true,progress} | null
async function get(a) {
  const j = await raw(a);
  if (!j) return null;
  if (j.status === 'ready') return { ready: true, data: j };
  if (j.status === 'warming') return { warming: true, progress: j.progress };
  return null;
}

(async () => {
  const files = fs.readdirSync(A).filter((f) => f.startsWith('points_snapshot_')).sort();
  const latest = JSON.parse(fs.readFileSync(path.join(A, files[files.length - 1]), 'utf8'));
  const all = JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map((x) => (typeof x === 'string' ? x : x.addr || x.address).toLowerCase());
  const missing = all.filter((a) => !latest.results[a]);
  console.log(`missing: ${missing.length} / ${all.length}`);
  const out = { asOf: new Date().toISOString(), base: files[files.length - 1], results: { ...latest.results }, errors: 0, retried: missing.length };

  for (let i = 0; i < missing.length; i++) {
    const a = missing[i];
    let j = null, st = 0;
    while (st < 40) {
      j = await get(a);
      if (j && j.warming) { if (st === 0 || st % 10 === 0) console.log(`warming ${((j.progress || 0) * 100).toFixed(0)}% — tunggu 60s...`); st++; await sleep(60000); continue; }
      if (!j) {
        let t = 0;
        while (!j && t < 4) { await sleep(1500 * (t + 1)); j = await get(a); t++; }
        if (j && j.warming) continue;
      }
      break;
    }
    if (j && j.ready) out.results[a] = { total: j.data.total || 0, fuel: j.data.fuel || 0, crew: j.data.crew || 0, liftoff: j.data.liftoff || 0, pendingFuel: j.data.pendingFuel || 0 };
    else out.errors++;
    if ((i + 1) % 50 === 0) console.log(`...${i + 1}/${missing.length} (err ${out.errors})`);
    await sleep(900);
  }
  const v = Object.values(out.results).map((x) => x.total).sort((a, b) => a - b);
  const above = v.filter((x) => x >= 500).length;
  out.summary = { scanned: v.length, above500: above, pct: +((above / v.length) * 100).toFixed(1), median: v[Math.floor(v.length / 2)], min: v[0], max: v[v.length - 1] };
  const f = path.join(A, `points_full_${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log('SELESAI →', f);
  console.log(JSON.stringify(out.summary));
})();
