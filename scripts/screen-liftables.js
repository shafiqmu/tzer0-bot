#!/usr/bin/env node
// screen-liftables.js — scan SEMUA mission on-chain, cari yang tinggal dikit lagi lift ("ekor" pendek).
// Kandidat "finisher": kita isi ekornya pakai wallet orphan → lapak lift → mereka dapet crew credit.
// Output: analysis/liftables.json (kandidat) + distribusi ekor.
// Pakai: node scripts/screen-liftables.js [--min-tail 0.004] [--max-tail 0.15]
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const LP = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';
const VT0 = 1.073e9, K = 1.073e8, LIFT = 0.2862, SOLD_TARGET = 795164681.5;
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const MIN_TAIL = arg('--min-tail', 0.004), MAX_TAIL = arg('--max-tail', 0.15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const abi = JSON.parse(fs.readFileSync(path.join(A, 'launchpad_full_abi.json'), 'utf8'));
  const lp = new ethers.Contract(LP, abi, provider);
  const n = Number(await lp.tokenCount());
  console.log(`tokenCount = ${n}`);
  const ours = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(A, 'missions_14.json'), 'utf8')).missions).map((m) => String(m.address).toLowerCase()));

  // daftar alamat (cache: cuma enumerasi yang baru)
  const cachePath = path.join(A, 'all_missions.json');
  let addrs = [];
  try { addrs = JSON.parse(fs.readFileSync(cachePath, 'utf8')).addrs || []; } catch (e) {}
  if (addrs.length > n) addrs = addrs.slice(0, n);
  for (let i = addrs.length; i < n; i += 25) {
    const idx = []; for (let j = i; j < Math.min(i + 25, n); j++) idx.push(j);
    const got = await Promise.all(idx.map((j) => lp.tokenAt(j).catch(() => null)));
    got.forEach((a, k) => { addrs[i + k] = a; });
    if (i % 500 === 0) console.log(`  addr ${i}/${n}`);
  }
  fs.writeFileSync(cachePath, JSON.stringify({ addrs }));

  const rows = []; let ok = 0, fail = 0, zero = 0;
  for (let i = 0; i < n; i += 25) {
    const idx = []; for (let j = i; j < Math.min(i + 25, n); j++) idx.push(j);
    const got = await Promise.all(idx.map(async (j) => {
      try { return { j, bps: Number(await lp.progressBps(addrs[j])) }; } catch (e) { return { j, bps: null }; }
    }));
    for (const g of got) {
      if (g.bps == null) { fail++; continue; }
      ok++;
      if (g.bps <= 0 || g.bps >= 10000) { zero++; continue; }
      const sold = (g.bps / 10000) * SOLD_TARGET;
      const R = K / (VT0 - sold) - 0.1;
      const tail = LIFT - R;
      if (ours.has(String(addrs[g.j]).toLowerCase())) continue;
      if (tail >= MIN_TAIL && tail <= MAX_TAIL) rows.push({ idx: g.j, address: addrs[g.j], bps: g.bps, raised: +R.toFixed(5), tail: +tail.toFixed(5) });
    }
    if (i % 500 === 0) console.log(`  bps ${i}/${n} — kandidat ${rows.length}`);
    await sleep(120);
  }
  rows.sort((a, b) => a.tail - b.tail);
  const buckets = {};
  for (const r of rows) { const b = (Math.floor(r.tail * 100) / 100).toFixed(2); buckets[b] = (buckets[b] || 0) + 1; }
  fs.writeFileSync(path.join(A, 'liftables.json'), JSON.stringify({ scannedAt: new Date().toISOString(), total: n, ok, fail, zero, minTail: MIN_TAIL, maxTail: MAX_TAIL, rows }, null, 1));
  console.log(`\n✅ scan selesai: ok=${ok} fail=${fail} (bps 0/10000: ${zero}) | kandidat ekor ${MIN_TAIL}-${MAX_TAIL} ETH: ${rows.length}`);
  console.log('distribusi ekor (ETH : jumlah):'); for (const [b, c] of Object.entries(buckets).sort()) console.log(`  ~${b}: ${c}`);
  const sum = rows.reduce((s, r) => s + r.tail, 0);
  console.log(`total kapasitas ekor: ${sum.toFixed(3)} ETH (${Math.round(sum * 1000)} tiket @0.001)`);
  console.log('\n12 ekor terpendek:'); rows.slice(0, 12).forEach((r) => console.log(`  tail ${r.tail}  raised ${r.raised}  ${r.address}  idx${r.idx}`));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
