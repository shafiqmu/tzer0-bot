#!/usr/bin/env node
// consolidate.js — pindahin ETH antar wallet fleet (aturan Tzero cuma melarang pindah TOKEN dlm 60 mnt dari beli; ETH bebas).
// Donor: wallet dgn saldo > reserve+minMove. Target: wallet kerja yg mau diisi sampai 'want'.
// OPTIMASI: scan target dulu → scan donor SAMPAI CUKUP (early-stop) → transfer paralel. (dulu: scan 1000 tiap kali = 7 menit)
// Usage: node scripts/consolidate.js --plan plan.json [--dry|--run] [--concurrency 20] [--reserve 0.0006] [--exclude file.txt]
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const CONC = Number(arg('--concurrency', 20));
const RESERVE = ethers.parseEther(arg('--reserve', '0.0006')); // sisa utk gas donor
const PLAN_FILE = arg('--plan');
const EXCLUDE_FILE = arg('--exclude');
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
  // yang gak boleh diambil duitnya (wallet yg bakal beli / sedang aktif)
  const excl = new Set();
  if (EXCLUDE_FILE) { try { for (const l of fs.readFileSync(path.join(ROOT, EXCLUDE_FILE), 'utf8').split(/\r?\n/)) { const a = l.trim().toLowerCase(); if (/^0x[0-9a-f]{40}$/.test(a)) excl.add(a); } } catch (e) {} }
  // NOTE: target TIDAK auto-exclude — target boleh jadi donor utk KELEBIHAN di atas want-nya (lihat keep di scan donor)

  console.log(`target: ${targets.size} | exclude: ${excl.size}`);

  const bal = new Map();
  const getBal = async (a) => { for (let t = 0; t < 3; t++) { try { return await provider.getBalance(a); } catch (e) { await sleep(350); } } return null; };

  // 1) saldo target (kecil, cepet — paralel 10)
  {
    const tArr = [...targets.keys()];
    for (let i = 0; i < tArr.length; i += 10) {
      const rs = await Promise.all(tArr.slice(i, i + 10).map(getBal));
      rs.forEach((b, j) => bal.set(tArr[i + j], b));
    }
  }
  const needs = new Map([...targets.entries()].map(([a, t]) => [a, t.want > (bal.get(a) || 0n) ? t.want - (bal.get(a) || 0n) : 0n]));
  const totalNeed = [...needs.values()].reduce((a, b) => a + b, 0n);
  console.log(`kebutuhan riil ≈ ${ethers.formatEther(totalNeed)} ETH`);

  // 2) scan donor SAMPAI CUKUP (early-stop) — urutan .env, paralel 15/chunk
  const addrs = [...byAddr.keys()].filter((a) => !excl.has(a));
  const donors = [];
  let have = 0n;
  const MIN_MOVE = ethers.parseEther('0.0002');
  for (let i = 0; i < addrs.length && have < totalNeed; i += 15) {
    const chunk = addrs.slice(i, i + 15);
    const rs = await Promise.all(chunk.map(getBal));
    rs.forEach((b, j) => { const a = chunk[j]; bal.set(a, b); const t = targets.get(a); const keep = t && t.want > RESERVE ? t.want : RESERVE; const mv = (b || 0n) - keep; if (mv > MIN_MOVE) { donors.push({ addr: a, movable: mv }); have += mv; } });
  }
  console.log(`donor terkumpul: ${donors.length} wallet ≈ ${ethers.formatEther(have)} ETH${have < totalNeed ? ' ⚠️ KURANG' : ' ✅'}`);

  // 3) alokasi donor → target
  const trans = [];
  let di = 0;
  for (const [ta, need] of needs) {
    let rem = need;
    if (rem === 0n) continue;
    while (rem > 0n && di < donors.length) {
      const d = donors[di];
      const amt = d.movable < rem ? d.movable : rem;
      trans.push({ from: d.addr, to: ta, amount: amt });
      rem -= amt;
      if (amt === d.movable) di++; else d.movable -= amt;
    }
    if (rem > 0n) console.log(`⚠️ kurang ${ethers.formatEther(rem)} ETH utk ${ta.slice(0, 10)}`);
  }
  const totalMoved = trans.reduce((a, b) => a + b.amount, 0n);
  console.log(`transfer rencana: ${trans.length} tx | total ${ethers.formatEther(totalMoved)} ETH`);
  if (!RUN) { console.log('DRY — berhenti.'); for (const t of trans.slice(0, 8)) console.log('  ', t.from.slice(0, 10), '→', t.to.slice(0, 10), ethers.formatEther(t.amount)); return; }

  // 4) eksekusi — dikelompokkan PER DONOR: satu donor jalan berurutan (nonce gak tabrakan), donor beda paralel
  let ok = 0, fail = 0;
  const failed = [];
  const byFrom = new Map();
  for (const t of trans) { if (!byFrom.has(t.from)) byFrom.set(t.from, []); byFrom.get(t.from).push(t); }
  const donorQ = [...byFrom.entries()];
  console.log(`donor dgn kiriman: ${donorQ.length} wallet`);
  async function worker() {
    while (donorQ.length) {
      const [from, list] = donorQ.shift();
      const w = new ethers.Wallet(byAddr.get(from), provider);
      for (const t of list) {
        let sent = false;
        for (let tr = 1; tr <= 2 && !sent; tr++) {
          try {
            const tx = await w.sendTransaction({ to: t.to, value: t.amount, gasLimit: 21000n });
            await tx.wait();
            ok++; sent = true;
            if (ok % 10 === 0) console.log(`  ✓ ${ok}/${trans.length}`);
          } catch (e) {
            const msg = String(e.shortMessage || e.message).slice(0, 80);
            if (tr === 2) { fail++; failed.push({ from, to: t.to, amount: ethers.formatEther(t.amount), err: msg }); console.log('  ✗', from.slice(0, 10), msg); }
            else await sleep(2500);
          }
        }
        await sleep(100);
      }
      await sleep(150);
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  console.log(`SELESAI: ${ok} ok | ${fail} gagal | pindah ≈ ${ethers.formatEther(totalMoved)} ETH`);
  fs.writeFileSync(path.join(ROOT, 'analysis', 'consolidate_last.json'), JSON.stringify({ ts: Date.now(), ok, fail, totalMoved: ethers.formatEther(totalMoved), failed: failed.slice(0, 60) }, null, 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
