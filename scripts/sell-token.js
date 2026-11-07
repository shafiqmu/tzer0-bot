#!/usr/bin/env node
// sell-token.js — jual token mission (post-lift) balik jadi ETH, via pair UniV2 langsung (tanpa router).
// Flow: curve[3] -> pair -> transfer token ke pair -> pair.swap(out WETH -> wallet) -> WETH.withdraw -> ETH native.
// Usage: node scripts/sell-token.js --wallet 0x.. --mission 0x.. [--pct 100] [--dry|--run] [--shave 998]
// Aman: hanya untuk post-lift (sold-before-liftoff kill crew — jangan dipakai pre-lift!).
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const mode = argv.includes('--run') ? 'run' : 'dry';
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const walletArg = arg('--wallet');
const missionArg = arg('--mission');
const pct = Number(arg('--pct', 100));
const shave = BigInt(arg('--shave', 985)); // per-1000; fee AMM ~1% (empiris: 99.0% lolos, 99.5% revert)
const WNATIVE = '0x4200000000000000000000000000000000000006';

if (!walletArg || !missionArg) { console.error('usage: --wallet 0x.. --mission 0x.. [--pct 100] [--dry|--run]'); process.exit(1); }

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map((s) => s.trim())
    .filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map((k) => (k.startsWith('0x') ? k : '0x' + k));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const keys = loadBareKeys(path.join(ROOT, '.env'));
  const byAddr = new Map();
  for (const k of keys) { try { const a = new ethers.Wallet(k).address.toLowerCase(); if (!byAddr.has(a)) byAddr.set(a, k); } catch (e) {} }
  const pk = byAddr.get(walletArg.toLowerCase());
  if (!pk) { console.error('key tidak ada di .env utk', walletArg); process.exit(1); }
  const wallet = new ethers.Wallet(pk, provider);

  const mission = ethers.getAddress(missionArg);
  const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c',
    ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], provider);
  const c = await lp.curve(mission);
  const pairAddr = c[3];
  const graduated = c[2];
  console.log(`mission ${mission.slice(0, 10)} | pair ${pairAddr.slice(0, 10)} | graduated: ${graduated}`);
  if (!graduated) { console.error('⛔ BELUM LIFT — jangan jual (sold-before-liftoff = crew hangus). stop.'); process.exit(1); }

  const pair = new ethers.Contract(pairAddr, [
    'function getReserves() view returns (uint112,uint112,uint32)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function swap(uint256,uint256,address)', 'function skim(address)'], provider);
  const wethC = new ethers.Contract(WNATIVE, [
    'function balanceOf(address) view returns (uint256)',
    'function withdraw(uint256)'], provider);

  const [t0, t1] = [String(await pair.token0()).toLowerCase(), String(await pair.token1()).toLowerCase()];
  const wn = WNATIVE.toLowerCase();
  const token = t0 === wn ? t1 : t0;       // sisi pair yg bukan WETH = token yg dijual
  const sellSide = token === t0 ? 0 : 1;   // jual sisi token0 atau token1
  console.log(`token ${token.slice(0, 10)} | pair token0=${t0.slice(0, 10)} token1=${t1.slice(0, 10)} → jual sisi ${sellSide}`);

  const tok = new ethers.Contract(token, [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function symbol() view returns (string)'], provider);

  const bal = await tok.balanceOf(wallet.address);
  const amount = (bal * BigInt(Math.round(pct))) / 100n;
  console.log(`saldo: ${ethers.formatEther(bal)} | jual ${pct}% = ${ethers.formatEther(amount)} | wallet ${wallet.address.slice(0, 10)}`);
  if (amount === 0n) { console.log('saldo 0 — gak ada yg dijual'); return; }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await pair.getReserves();
    const r0 = r[0], r1 = r[1];
    let out, outSafe;
    if (sellSide === 1) { const wf = amount * 997n; out = (wf * r0) / (r1 * 1000n + wf); }
    else { const wf = amount * 997n; out = (wf * r1) / (r0 * 1000n + wf); }
    outSafe = (out * shave) / 1000n;
    console.log(`attempt ${attempt}: reserves ${ethers.formatEther(r0)} / ${ethers.formatEther(r1)} → out ≈ ${ethers.formatEther(outSafe)} ETH`);

    if (mode === 'dry') { console.log('DRY — berhenti di sini'); return; }

    try {
      const tx1 = await tok.connect(wallet).transfer(pairAddr, amount, { gasLimit: 120000n });
      await tx1.wait();
      console.log('  transfer → pair ok', String(tx1.hash).slice(0, 18));
      const args = sellSide === 1 ? [outSafe, 0n, wallet.address] : [0n, outSafe, wallet.address];
      const tx2 = await pair.connect(wallet).swap(...args, { gasLimit: 250000n });
      await tx2.wait();
      console.log('  swap ok', String(tx2.hash).slice(0, 18));
      const wb = await wethC.balanceOf(wallet.address);
      console.log('  WETH diterima:', ethers.formatEther(wb));
      if (wb > 0n) { const tx3 = await wethC.connect(wallet).withdraw(wb, { gasLimit: 100000n }); await tx3.wait(); console.log('  withdraw WETH→ETH ok'); }
      const eth = await provider.getBalance(wallet.address);
      console.log(`DONE ✅ saldo ETH wallet skrg: ${ethers.formatEther(eth)}`);
      return;
    } catch (e) {
      console.log('  ⚠️ gagal:', String(e.shortMessage || e.message).slice(0, 140));
      await sleep(4000);
    }
  }
  // semua attempt gagal — tarik balik token yg mungkin nyangkut di pair (skim)
  try {
    const sk = await pair.connect(wallet).skim(wallet.address, { gasLimit: 150000n });
    await sk.wait();
    console.log('gagal 3x — token ditarik balik (skim ok)');
  } catch (e) {
    console.log('gagal 3x — token mungkin nyangkut di pair:', String(e.shortMessage || e.message).slice(0, 90));
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
