#!/usr/bin/env node
// sell-token.js — jual token mission (post-lift) jadi ETH native via TZERO ROUTER.
// Router: swapExactTokensForNative(token, amountIn, minOut, to, deadline) — output dihitung saat eksekusi
// (tanpa celah rebutan harga antar-lane), kirim ETH native langsung (tanpa WETH withdraw). Revert = gak ada yg pindah (aman).
// Usage: node scripts/sell-token.js --wallet 0x.. --mission 0x.. [--pct 100] [--dry|--run] [--shave 850] [--retries 6]
// CATATAN: hanya untuk post-lift (aturan poin Tzero).
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
const shave = BigInt(arg('--shave', 850)); // minOut = quote × shave/1000 (default 85% — toleran biar gak gagal rebutan)
const retries = Number(arg('--retries', 6));
const ROUTER = '0x21BbD201c69d0091707d0367D3AD6875cEc150e1'; // TzeroRouter (verified)

if (!walletArg || !missionArg) { console.error('usage: --wallet 0x.. --mission 0x.. [--pct 100] [--dry|--run] [--shave 850] [--retries 6]'); process.exit(1); }

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
  const graduated = c[2];
  if (!graduated) { console.error('⛔ BELUM LIFT — jangan jual (aturan poin Tzero). stop.'); process.exit(1); }

  const token = mission; // token Tzero = alamat mission itu sendiri
  const tok = new ethers.Contract(token, [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)'], provider);
  const router = new ethers.Contract(ROUTER, [
    'function quoteTokensForNative(address,uint256) view returns (uint256)',
    'function swapExactTokensForNative(address,uint256,uint256,address,uint256) returns (uint256)'], provider);

  const bal = await tok.balanceOf(wallet.address);
  const amount = (bal * BigInt(Math.round(pct))) / 100n;
  console.log(`mission ${mission.slice(0, 10)} | saldo jual ${ethers.formatEther(amount)} token | wallet ${wallet.address.slice(0, 10)}`);
  if (amount === 0n) { console.log('saldo 0 — gak ada yg dijual'); return; }

  const quote = await router.quoteTokensForNative(token, amount);
  console.log(`quote ≈ ${ethers.formatEther(quote)} ETH | minOut ${Number(shave) / 10}% dari quote`);
  if (mode === 'dry') { console.log('DRY — berhenti di sini'); return; }

  // approve router sekali (biar tx jual langsung jalan)
  const allow = await tok.allowance(wallet.address, ROUTER);
  if (allow < amount) {
    const ap = await tok.connect(wallet).approve(ROUTER, ethers.MaxUint256, { gasLimit: 100000n });
    await ap.wait();
    console.log('  approve ok', String(ap.hash).slice(0, 18));
  }

  for (let i = 1; i <= retries; i++) {
    try {
      const q = await router.quoteTokensForNative(token, amount);
      const mo = (q * shave) / 1000n;
      const deadline = Math.floor(Date.now() / 1000) + 1200;
      const tx = await router.connect(wallet).swapExactTokensForNative(token, amount, mo, wallet.address, deadline, { gasLimit: 400000n });
      await tx.wait();
      console.log(`  swap OK (try ${i}) — quote ${ethers.formatEther(q)} ETH | tx ${String(tx.hash).slice(0, 18)}`);
      const eth = await provider.getBalance(wallet.address);
      console.log(`DONE ✅ saldo ETH wallet skrg: ${ethers.formatEther(eth)}`);
      return;
    } catch (e) {
      console.log(`  ⚠️ try ${i}: ${String(e.shortMessage || e.message).slice(0, 120)}`);
      await sleep(4000);
    }
  }
  console.log('gagal semua — token TIDAK pindah (aman, bisa dicoba lagi)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
