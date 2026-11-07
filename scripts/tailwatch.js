#!/usr/bin/env node
// tailwatch.js — pantau kandidat "ekor" (analysis/liftables.json).
// Cetak HANYA kalau ada yang bergerak (bps naik) atau LIFT/hilang. Dipanggil dari cron watchdog.
'use strict';
const fs = require('fs');
const { ethers } = require('ethers');
const A = '/home/ubuntu/tzer0-bot/analysis';
(async () => {
  const p = new ethers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
  const abi = JSON.parse(fs.readFileSync(A + '/launchpad_full_abi.json', 'utf8'));
  const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', abi, p);
  const rows = JSON.parse(fs.readFileSync(A + '/liftables.json', 'utf8')).rows;
  const stPath = A + '/tailwatch_state.json';
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stPath, 'utf8')); } catch (e) {}
  const msgs = [];
  const now = {};
  for (const r of rows) {
    let bps = null;
    try { bps = Number(await lp.progressBps(r.address)); } catch (e) {}
    now[r.address] = bps;
    const old = st[r.address];
    if (old != null && bps != null && Math.abs(bps - old) >= 25) {
      msgs.push(`${r.address.slice(0, 10)}… (ekor ${r.tail}) bps ${old}→${bps}${bps >= 10000 ? ' — LIFT/HILANG!' : ''}`);
    }
  }
  fs.writeFileSync(stPath, JSON.stringify(now));
  if (msgs.length) console.log('🦎 [tzero] kandidat ekor gerak:\n' + msgs.join('\n'));
})().catch((e) => console.error('tailwatch err:', e.message));
