#!/usr/bin/env node
// spread-donors.js — sebar dana dari relay utama ke banyak donor segar (buat pasokan funding 12 jalur)
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');

const RELAY = process.env.SPREAD_RELAY || ''; // ⚠️ alamat relay lu — isi via env SPREAD_RELAY (dulu hardcoded, di-sanitize utk repo publik)
const N_DONORS = 28;
const AMT = 0.085;
const KEEP = 0.45; // sisa di relay (sisanya biarin disedot funding)

(async () => {
  const p = new ethers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
  const keys = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^0x[a-fA-F0-9]{64}$/.test(l));
  const wallets = keys.map((k) => new ethers.Wallet(k));
  const byAddr = new Map(wallets.map((w) => [w.address.toLowerCase(), w]));
  const relay = byAddr.get(RELAY);
  if (!relay) throw new Error('relay key gak ketemu di .env');
  const relayBal = Number(ethers.formatEther(await p.getBalance(relay.address)));
  console.log('relay balance:', relayBal.toFixed(4), 'ETH');
  if (relayBal < KEEP + N_DONORS * AMT + 0.02) throw new Error('saldo gak cukup? ' + relayBal);
  const pv = relay.connect(p);

  // exclusion: wallet misi aktif m140/m141 + relay sendiri + saldo >0.002
  const excl = new Set([relay.address.toLowerCase()]);
  for (const n of [140, 141]) {
    try { const pl = JSON.parse(fs.readFileSync(path.join(A, `line_m${n}_plan.json`), 'utf8')); for (const e of pl) excl.add(e.addr.toLowerCase()); } catch (e) {}
  }
  const cand = [];
  for (const w of wallets) {
    const a = w.address.toLowerCase();
    if (excl.has(a)) continue;
    const b = Number(ethers.formatEther(await p.getBalance(a)));
    if (b > 0.002) continue;
    cand.push(a);
  }
  console.log('kandidat donor:', cand.length);
  // shuffle seeded
  let s = 20261110;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const picked = cand.slice(0, N_DONORS);

  const out = { ts: new Date().toISOString(), relay: relay.address, amount: AMT, donors: [], txs: [] };
  let ok = 0;
  for (const a of picked) {
    try {
      const t = await pv.sendTransaction({ to: a, value: ethers.parseEther(String(AMT)) });
      await t.wait();
      out.donors.push(a); out.txs.push(t.hash); ok++;
      console.log(`✓ ${a.slice(0, 12)} +${AMT} (${ok}/${N_DONORS})`);
    } catch (e) { console.log(`✗ ${a.slice(0, 12)} gagal: ${String(e.message).slice(0, 80)}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  fs.writeFileSync(path.join(A, `spread_${Date.now()}.json`), JSON.stringify(out, null, 1));
  const left = Number(ethers.formatEther(await p.getBalance(relay.address)));
  console.log(`SELESAI: ${ok}/${N_DONORS} donor × ${AMT} | relay sisa: ${left.toFixed(4)} ETH`);
})();
