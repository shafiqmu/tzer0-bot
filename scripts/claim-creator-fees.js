#!/usr/bin/env node
// claim-creator-fees.js — klaim creatorFees() dari TzeroFeeSplitter utk semua wallet creator mission kita.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
const SPLITTER = '0x1C69a90c69fdb2F2E459fCA23cA6B22ACD707B3b';
const sp = new ethers.Contract(SPLITTER, ['function creatorFees(address) view returns (uint256)', 'function claimCreatorFees()'], p);

function loadBareKeys(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (/^0x[a-fA-F0-9]{64}$/.test(t)) out.push(t);
  }
  return out;
}

(async () => {
  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const kmap = new Map();
  for (const k of keys) { const w = new ethers.Wallet(k); kmap.set(w.address.toLowerCase(), k); }
  console.log(`keys: ${keys.length}`);

  // kumpulin semua creator dari plan file
  const seen = new Set();
  const creators = [];
  for (const dir of fs.readdirSync(path.join(ROOT, 'analysis'))) {
    const m = dir.match(/^line_m(\d+)_plan\.json$/);
    if (!m) continue;
    try {
      const pl = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', dir), 'utf8'));
      const c = (pl.find((x) => x.role === 'creator') || {}).addr;
      if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); creators.push(Number(m[1])); }
    } catch (e) {}
  }
  // creator list dgn nomor mission
  const perCreate = [];
  for (const n of creators) {
    try {
      const pl = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', `line_m${n}_plan.json`), 'utf8'));
      const c = (pl.find((x) => x.role === 'creator') || {}).addr;
      if (c) perCreate.push([n, c]);
    } catch (e) {}
  }
  console.log(`mission dgn plan: ${perCreate.length}`);

  // cek fee pending per creator unik
  const uniq = new Map();
  for (const [n, c] of perCreate) {
    const lc = c.toLowerCase();
    if (!uniq.has(lc)) uniq.set(lc, { n, c });
  }
  console.log(`creator unik: ${uniq.size}`);

  let potTotal = 0;
  const claimList = [];
  for (const { n, c } of uniq.values()) {
    try {
      const f = await sp.creatorFees(c);
      const v = Number(ethers.formatEther(f));
      if (v >= 0.0003) { potTotal += v; claimList.push({ n, c, v }); }
    } catch (e) {}
  }
  claimList.sort((a, b) => b.v - a.v);
  console.log(`wallet utk claim: ${claimList.length} | pot: ${potTotal.toFixed(5)} ETH`);

  let ok = 0, fail = 0, claimed = 0;
  for (const { n, c, v } of claimList) {
    const k = kmap.get(c.toLowerCase());
    if (!k) { console.log(`✗ ${c.slice(0, 10)} — key gak ada di .env`); fail++; continue; }
    try {
      const w = new ethers.Wallet(k, p);
      const tx = await sp.connect(w).claimCreatorFees({ gasLimit: 300000n });
      await tx.wait();
      ok++; claimed += v;
      console.log(`✓ m${n} ${c.slice(0, 10)} claim ${v.toFixed(5)} ETH (tx ${tx.hash.slice(0, 12)})`);
    } catch (e) {
      fail++;
      console.log(`✗ m${n} ${c.slice(0, 10)} gagal: ${(e.shortMessage || e.message || '').slice(0, 80)}`);
    }
  }
  console.log(`\nSELESAI: ${ok} claim ok | ${fail} gagal | terkumpul ≈ ${claimed.toFixed(5)} ETH`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
