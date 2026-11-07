#!/usr/bin/env node
// repair-grab.js — fase panen "ekor lapak orang": wallet orphan (yang udah bebas) belanja
// 0.001 ETH ke mission ekor sampai lapaknya LIFT. 1 wallet = 1 tiket = 1 kredit repair.
// Input: analysis/repair_plan.json = [{wallet, mission}]
// Pakai: node scripts/repair-grab.js --dry | --run [--min-delay 5 --max-delay 12]
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { buyMission } = require('../src/actions/mission');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const argv = process.argv.slice(2);
const mode = argv.includes('--run') ? 'run' : 'dry';
const argN = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };
const minDelay = argN('--min-delay', 5), maxDelay = argN('--max-delay', 12);

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

(async () => {
  const plan = JSON.parse(fs.readFileSync(path.join(A, 'repair_plan.json'), 'utf8'));
  const stPath = path.join(A, 'repair_state.json');
  const state = fs.existsSync(stPath) ? JSON.parse(fs.readFileSync(stPath, 'utf8')) : { done: {}, skip1: {} };

  // ringkasan per mission
  const perM = {};
  for (const p of plan) { perM[p.mission] = (perM[p.mission] || 0) + 1; }
  console.log(`plan: ${plan.length} wallet → ${Object.entries(perM).map(([m, c]) => m.slice(0, 10) + ':' + c).join(' | ')}`);
  console.log(`sudah beres: ${Object.keys(state.done).length} | di-skip(pindah): ${Object.keys(state.skip1).length}`);

  if (mode === 'dry') {
    let todo = 0;
    for (const p of plan) { const w = p.wallet.toLowerCase(); if (!state.done[w] && !state.skip1[w]) todo++; }
    console.log(`DRY: sisa yang bakal dieksekusi: ${todo}`);
    return;
  }

  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const a = new ethers.Wallet(k).address.toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, k); } catch (e) {} }
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const wc = new Map();
  const signerOf = (a) => { const l = a.toLowerCase(); if (!wc.has(l)) { const k = byAddr.get(l); if (!k) throw new Error('no key in .env for ' + a); wc.set(l, new ethers.Wallet(k, provider)); } return wc.get(l); };
  const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function buy(address token, uint256 minTokensOut) payable'], provider);

  const save = () => fs.writeFileSync(stPath, JSON.stringify(state));
  const gradMissions = new Set();
  let sent = 0, fails = 0;

  for (const p of plan) {
    const w = p.wallet.toLowerCase();
    if (state.done[w] || state.skip1[w]) continue;

    if (gradMissions.has(p.mission)) { state.skip1[w] = true; save(); continue; }
    // cek mission masih live (pakai from wallet biar bersih)
    try { await lp.buy.staticCall(p.mission, 0n, { value: ethers.parseEther('0.001'), from: p.wallet }); }
    catch (e) {
      const msg = String(e.shortMessage || e.message);
      if (/GRADUATED/.test(msg)) { gradMissions.add(p.mission); state.skip1[w] = true; save(); console.log(`⏹️  ${p.mission.slice(0, 10)} udah LIFT — ${w.slice(0, 10)} dipindah`); continue; }
      // error lain (mis. saldo) — biarkan dicoba di tx asli
    }
    const bal = await provider.getBalance(p.wallet);
    if (bal < ethers.parseEther('0.00105')) {
      state.skip1[w] = true; save();
      console.log(`💸 saldo kurang ${w.slice(0, 10)} (${ethers.formatEther(bal)}) — skip`);
      continue;
    }
    try {
      const r = await buyMission(signerOf(p.wallet), p.mission, '0.001');
      state.done[w] = { mission: p.mission, ts: Date.now(), txHash: r.txHash };
      save(); sent++;
      console.log(`✅ ${w.slice(0, 10)} → ${p.mission.slice(0, 10)} | ${String(r.txHash).slice(0, 16)}`);
      try { fs.appendFileSync(path.join(A, 'repair_log.txt'), `[${new Date().toISOString()}] OK ${w} ${p.mission} ${r.txHash}\n`); } catch (e) {}
    } catch (e) {
      const msg = String(e.shortMessage || e.message);
      try { fs.appendFileSync(path.join(A, 'repair_log.txt'), `[${new Date().toISOString()}] ERR ${w} ${p.mission} ${msg.slice(0, 120)}\n`); } catch (e2) {}
      if (/GRADUATED/.test(msg)) { gradMissions.add(p.mission); state.skip1[w] = true; save(); console.log(`⏹️  ${p.mission.slice(0, 10)} lift pas kirim — ${w.slice(0, 10)} dipindah`); continue; }
      fails++;
      console.log(`❌ ${w.slice(0, 10)}: ${msg.slice(0, 90)}`);
    }
    await sleep(rand(minDelay, maxDelay) * 1000);
  }
  console.log(`\n🏁 Grab selesai: terkirim ${sent} | gagal ${fails} | total beres: ${Object.keys(state.done).length}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
