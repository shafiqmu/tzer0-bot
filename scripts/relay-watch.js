#!/usr/bin/env node
// relay-watch.js — pantau relay utama; begitu duit masuk (≥0.3 ETH) → split rata ke 4 relay + lapor.
// Relay utama = relays.json[0]. Dinonaktifkan sendiri setelah sukses atau 6 jam.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = '/home/ubuntu/tzer0-bot';
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');

(async () => {
  const relays = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'relays.json'), 'utf8')).relays;
  const MAIN = relays[0];
  const keys = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => /^0x[a-fA-F0-9]{64}$/.test(l));
  const kmap = new Map();
  for (const k of keys) { const w = new ethers.Wallet(k); kmap.set(w.address.toLowerCase(), k); }
  const mainKey = kmap.get(MAIN.toLowerCase());
  if (!mainKey) { console.log('FATAL: key relay utama gak ada di .env'); process.exit(1); }
  const wallet = new ethers.Wallet(mainKey, p);
  const DEADLINE = Date.now() + 6 * 3600e3;
  console.log('watch', MAIN, 'sampai', new Date(DEADLINE).toISOString());

  while (Date.now() < DEADLINE) {
    let v = 0;
    try { v = Number(ethers.formatEther(await p.getBalance(MAIN))); } catch (e) {}
    if (v >= 0.3) {
      console.log(`💰 DUIT MASUK: ${v.toFixed(4)} ETH di relay utama → split ke 4 relay...`);
      const target = (v * 0.985) / 4;
      let sent = 0, ok = 0;
      for (let i = 1; i < Math.min(relays.length, 4); i++) {
        try {
          const cur = Number(ethers.formatEther(await p.getBalance(relays[i])));
          const need = target - cur;
          if (need <= 0.001) { console.log(`• ${relays[i].slice(0, 10)} udah cukup (${cur.toFixed(4)})`); continue; }
          const tx = await wallet.sendTransaction({ to: relays[i], value: ethers.parseEther(need.toFixed(6)) });
          await tx.wait();
          ok++; sent += need;
          console.log(`→ ${relays[i].slice(0, 10)} +${need.toFixed(4)} ETH`);
        } catch (e) { console.log(`✗ ${relays[i].slice(0, 10)} ${(e.shortMessage || e.message || '').slice(0, 70)}`); }
      }
      const rest = Number(ethers.formatEther(await p.getBalance(MAIN)));
      console.log(`SELESAI: ${ok} split ok | terdistribusi ${sent.toFixed(4)} ETH | sisa relay utama ${rest.toFixed(4)} ETH`);
      console.log('PARIPURNA SIAP ✅ — donors jalan, line bakal nyedot otomatis tiap tick.');
      return;
    }
    await new Promise((r) => setTimeout(r, 90000));
  }
  console.log('(relay-watch habis waktu 6 jam tanpa duit masuk — exit senyap)');
})();
