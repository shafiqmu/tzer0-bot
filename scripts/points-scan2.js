#!/usr/bin/env node
// points-scan2.js — scan penuh semua wallet, SABAR nunggu API 'warming' → 'ready'
// Simpan progres incremental ke analysis/points_scan_<ts>.json
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36', accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TS = Date.now();
const OUT = path.join(A, `points_scan_${TS}.json`);

function raw(a) {
  return new Promise((res) => {
    https.get({ hostname: 'testnet.tzer0.fun', path: '/api/points/' + a, headers: UA, timeout: 25000 }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { res(null); } });
    }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null); });
  });
}
async function waitReady(maxMin = 30) {
  const end = Date.now() + maxMin * 60000;
  while (Date.now() < end) {
    const j = await raw('0x0000000000000000000000000000000000000000');
    if (j && j.status === 'ready') return true;
    await sleep(15000);
  }
  return false;
}

(async () => {
  const all = JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8'))
    .map((x) => (typeof x === 'string' ? x : x.addr || x.address).toLowerCase());
  const out = { asOf: new Date().toISOString(), results: {}, errors: 0, warmingWaits: 0 };
  const save = () => fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`[scan2] ${all.length} wallet → ${OUT}`);
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    let j = await raw(a);
    if (j && j.status === 'warming') {
      out.warmingWaits++;
      console.log(`[scan2] warming @${i}/${all.length} — tunggu ready...`);
      await waitReady(30);
      j = await raw(a);
    }
    if (j && j.status === 'ready') {
      out.results[a] = { total: j.total, fuel: j.fuel, crew: j.crew, liftoff: j.liftoff, staking: j.staking, signal: j.signal, pending: j.attributionPending, rank: j.rank };
    } else {
      out.errors++;
    }
    if (i % 50 === 0) { save(); console.log(`[scan2] progres ${i}/${all.length} | ok:${Object.keys(out.results).length} err:${out.errors}`); }
    await sleep(650);
  }
  save();
  const vals = Object.values(out.results).map((r) => r.total);
  vals.sort((x, y) => y - x);
  const over = vals.filter((v) => v >= 500).length;
  console.log(`[scan2] SELESAI. kebaca ${vals.length}/${all.length} | >=500: ${over} | median: ${vals[Math.floor(vals.length / 2)]} | max: ${vals[0]}`);
})();
