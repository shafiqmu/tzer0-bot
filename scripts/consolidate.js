#!/usr/bin/env node
// consolidate.js — pindahin ETH antar wallet fleet (boleh: aturan Tzero cuma melarang pindah TOKEN dlm 60 mnt dari beli; ETH bebas).
// Donor: wallet dgn saldo > reserve+minMove. Target: wallet kerja yg mau diisi sampai 'want'.
// Usage: node scripts/consolidate.js --plan analysis/factory_plan.json [--dry|--run] [--concurrency 20] [--reserve 0.0006]
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const CONC = Number(arg('--concurrency', 20));
const RESERVE = ethers.parseEther(arg('--reserve', '0.0006')); // sisa utk gas donor
const PLAN_FILE = arg('--plan');
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';

function loadBareKeys(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim()).filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, PLAN_FILE), 'utf8')); // [{addr, want}]
  const provider = new ethers.JsonRpcProvider(RPC);
  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const w = new ethers.Wallet(k); byAddr.set(w.address.toLowerCase(), k); } catch (e) {} }

  const targets = new Map(plan.map((t) => [t.addr.toLowerCase(), { want: ethers.parseEther(String(t.want)), addr: t.addr }]));
  console.log(`target wallet: ${targets.size} | total butuh ≈ ${ethers.formatEther([...targets.values()].reduce((a, b) => a + b.want, 0n))} ETH`);

  // scan semua saldo (concurrency 10 + retry — RPC publik suka nolak kalau kegedean)
  const addrs = [...byAddr.keys()];
  const bal = new Map();
  let scanFail = 0;
  for (let i = 0; i < addrs.length; i += 10) {
    const chunk = addrs.slice(i, i + 10);
    for (const a of chunk) {
      let b = null;
      for (let t = 0; t < 3 && b === null; t++) {
        try { b = await provider.getBalance(a); } catch (e) { await sleep(400); }
      }
      if (b === null) { b = 0n; scanFail++; }
      bal.set(a, b);
    }
  }
  console.log(`scan saldo selesai (gagal baca: ${scanFail})`);

  // hitung alokasi: donor (bukan target) → target kekurangan
  const needs = new Map([...targets.entries()].map(([a, t]) => [a, t.want > bal.get(a) ? t.want - bal.get(a) : 0n]));
  const trans = []; // {from, to, amount}
  let i = 0; const addrsArr = addrs.filter((a) => !targets.has(a));
  for (const [ta, need] of needs) {
    let rem = need;
    if (rem === 0n) continue;
    while (rem > 0n && i < addrsArr.length) {
      const da = addrsArr[i]; i++;
      const movable = bal.get(da) - RESERVE;
      if (movable <= ethers.parseEther('0.0002')) continue;
      const amt = movable < rem ? movable : rem;
      trans.push({ from: da, to: ta, amount: amt });
      rem -= amt;
    }
    if (rem > 0n) console.log(`⚠️ kurang ${ethers.formatEther(rem)} ETH utk ${ta.slice(0, 10)}`);
  }
  const totalMoved = trans.reduce((a, b) => a + b.amount, 0n);
  console.log(`transfer rencana: ${trans.length} tx | total ${ethers.formatEther(totalMoved)} ETH`);
  if (!RUN) { console.log('DRY — berhenti.'); for (const t of trans.slice(0, 8)) console.log('  ', t.from.slice(0, 10), '→', t.to.slice(0, 10), ethers.formatEther(t.amount)); return; }

  // eksekusi paralel (tiap donor 1 tx → no nonce clash)
  let ok = 0, fail = 0;
  const queue = [...trans];
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      try {
        const w = new ethers.Wallet(byAddr.get(t.from), provider);
        const tx = await w.sendTransaction({ to: t.to, value: t.amount, gasLimit: 21000n });
        await tx.wait();
        ok++;
        if (ok % 10 === 0) console.log(`  ✓ ${ok}/${trans.length} · ${ethers.formatEther(totalMoved)} target`);
      } catch (e) {
        fail++;
        console.log('  ✗', t.from.slice(0, 10), String(e.shortMessage || e.message).slice(0, 90));
      }
      await sleep(200);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`SELESAI: ${ok} ok | ${fail} gagal | pindah ≈ ${ethers.formatEther(totalMoved)} ETH`);
  fs.writeFileSync(path.join(A, 'consolidate_log.json'), JSON.stringify({ ts: Date.now(), ok, fail, trans }, (k, v) => (typeof v === 'bigint' ? String(v) : v), 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
