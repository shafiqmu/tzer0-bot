#!/usr/bin/env node
/**
 * distribute.js — sebar top-up dari wallet RELAY (kunci ada di .env fleet) ke wallet fleet
 * lainnya, sesuai analysis/topup_plan_v2.json. Pengganti peran funder pribadi.
 *
 * Relays: analysis/relays.json  (4 wallet, tiap relay kebagian ~250 target)
 *
 * Cara pakai (root repo):
 *   node scripts/distribute.js --relay 0 --dry
 *   node scripts/distribute.js --relay 0 --run
 *   (jalankan 4 relay, boleh paralel: --relay 0..3)
 *   Opsi: --min-delay 6 --max-delay 25 (detik) | --limit N
 * Resumable: analysis/distribute_state_<N>.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const ANALYSIS = path.join(ROOT, 'analysis');
const PLAN = path.join(ANALYSIS, 'topup_plan_v2.json');
const RELAYS = path.join(ANALYSIS, 'relays.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
function argNum(argv, name, def) { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : def; }

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}

async function main() {
  const argv = process.argv.slice(2);
  const run = argv.includes('--run');
  const dry = !run;
  const relayIdx = argv.indexOf('--relay');
  if (relayIdx < 0) { console.error('❌ butuh --relay N (0..3)'); process.exit(1); }
  const N = Number(argv[relayIdx + 1]);
  const minD = argNum(argv, '--min-delay', 6);
  const maxD = argNum(argv, '--max-delay', 25);
  const limit = argNum(argv, '--limit', Infinity);

  const relays = JSON.parse(fs.readFileSync(RELAYS, 'utf8')).relays.map((a) => a.toLowerCase());
  if (!relays[N]) { console.error('❌ relay index salah'); process.exit(1); }
  const relayAddr = relays[N];
  const relaySet = new Set(relays);

  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const all = Object.entries(plan.topup || {}).filter(([a, v]) => v > 0 && !relaySet.has(a.toLowerCase()));
  const entries = all.filter((_, i) => i % relays.length === N);

  const STATE = path.join(ANALYSIS, `distribute_state_${N}.json`);
  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { sent: {} };
  const pending = entries.filter(([a]) => !state.sent[a]);
  const sliceTotal = entries.reduce((s, [, v]) => s + v, 0);

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const bal = await provider.getBalance(relayAddr);

  console.log(`🛰️  Relay #${N}: ${relayAddr}`);
  console.log(`   saldo: ${ethers.formatEther(bal)} ETH`);
  console.log(`📋 Slice: ${entries.length} wallet | total sebar: ${sliceTotal.toFixed(6)} ETH | belum kena: ${pending.length} | mode: ${dry ? 'DRY' : 'LIVE'}`);

  const need = ethers.parseEther(sliceTotal.toFixed(6)) + ethers.parseEther('0.008');

  if (dry) {
    pending.slice(0, 5).forEach(([a, v]) => console.log(`   [contoh] ${a} ← ${v}`));
    console.log(`   butuh saldo relay: ≥ ${ethers.formatEther(need)} ETH (sekarang ${ethers.formatEther(bal)})`);
    console.log(`   estimasi durasi: ~${(pending.length * (minD + maxD) / 2 / 3600).toFixed(1)} jam`);
    return;
  }

  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const a = new ethers.Wallet(k).address.toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, k); } catch (e) {} }
  const relayKey = byAddr.get(relayAddr);
  if (!relayKey) { console.error(`❌ kunci relay ${relayAddr} gak ada di .env`); process.exit(1); }
  const relay = new ethers.Wallet(relayKey, provider);

  if (bal < need) {
    console.error(`❌ saldo relay kurang: punya ${ethers.formatEther(bal)}, butuh ≥ ${ethers.formatEther(need)}`);
    process.exit(1);
  }

  let sent = 0;
  for (const [addr, amount] of pending) {
    if (sent >= limit) { console.log(`⏹️  limit ${limit}`); break; }
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        const tx = await relay.sendTransaction({ to: addr, value: ethers.parseEther(amount.toFixed(6)) });
        await tx.wait(1, 240000);
        state.sent[addr] = { txHash: tx.hash, amount, ts: Date.now() };
        ok = true; sent++;
        if (sent % 25 === 0) {
          fs.writeFileSync(STATE, JSON.stringify(state));
          console.log(`   ✅ ${sent}/${pending.length}`);
        }
      } catch (e) {
        console.error(`   ⚠️ ${addr} attempt ${attempt}: ${e.shortMessage || e.message}`);
        await sleep(5000);
      }
    }
    if (!ok) console.error(`   ❌ ${addr} gagal 3x — lanjut`);
    await sleep(rand(minD, maxD) * 1000);
  }
  fs.writeFileSync(STATE, JSON.stringify(state));
  const left = entries.length - Object.keys(state.sent).length;
  const bal2 = await provider.getBalance(relay.address);
  console.log(`\n🏁 Relay #${N} selesai: terkirim ${sent} | sisa belum: ${left} | saldo akhir: ${ethers.formatEther(bal2)} ETH`);
}
main().catch((e) => { console.error(e); process.exit(1); });
