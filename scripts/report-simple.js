#!/usr/bin/env node
// report-simple.js — laporan jam-an bahasa manusia (dipanggil watchdog).
// Output: 6-10 baris simpel. Detail teknis tetap ada di logs/ + progress.js.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return d; } };

(async () => {
  const out = [];
  const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
  out.push(`📋 LAPORAN TZERO (${now})`);

  // 1) status mission kita
  let lifted = 0, total = 0;
  try {
    const M = rd('missions_14.json', { missions: {} }).missions;
    const { ethers } = require('ethers');
    const p = new ethers.JsonRpcProvider('https://base-sepolia-rpc.publicnode.com');
    const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', rd('launchpad_full_abi.json', []), p);
    for (const k of Object.keys(M)) {
      total++;
      try { const b = Number(await lp.progressBps(M[k].address)); if (b >= 10000) lifted++; } catch (e) {}
    }
  } catch (e) {}
  out.push(`🏁 Mission kita: ${lifted}/${total || 14} udah LIFT naik`);

  // 2) poin wallet (sample cepat 12 wallet)
  try {
    const wl = rd('wallets_full.json', []);
    const pick = [];
    const step = Math.max(1, Math.floor(wl.length / 12));
    for (let i = 0; i < wl.length && pick.length < 12; i += step) pick.push(typeof wl[i] === 'string' ? wl[i] : wl[i].address);
    let sum = 0, n = 0, hi = 0, ready = 0;
    for (const a of pick) {
      try {
        const r = await fetch('https://testnet.tzer0.fun/api/points/' + a, { signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        const t = j.total || 0; sum += t; n++; if (t > hi) hi = t; if (t >= 500) ready++;
      } catch (e) {}
    }
    if (n) out.push(`⭐ Poin wallet: rata2 ${(sum / n).toFixed(1)} (cek ${n} wallet) · tertinggi ${hi} · yang udah lolos 500: ${ready}`);
    else out.push('⭐ Poin wallet: (web lagi gak bisa dicek, coba lagi nanti)');
  } catch (e) { out.push('⭐ Poin wallet: (gagal cek)'); }

  // 3) mesin tarik duit (sweep jual)
  try {
    let sold = 0, empty = 0, fail = 0, eth = 0n;
    let any = false;
    for (let i = 0; i < 4; i++) {
      const s = rd(`sell_state_${i}.json`, null);
      if (s) { any = true; const d = Object.values(s.done || {}); sold += d.length; empty += Object.keys(s.empty || {}).length; fail += Object.keys(s.fail || {}).length; for (const v of d) eth += BigInt(v.gainWei || 0); }
    }
    const ethN = (Number(eth) / 1e18).toFixed(4);
    if (!any) out.push('💸 Tarik duit balik: belum mulai (lagi nunggu mesin lain beres)');
    else out.push(`💸 Tarik duit balik: ${sold} penjualan sukses · ~${ethN} ETH udah cair · sisa antre ${empty + fail > 0 ? '' : ''}${empty} kosong`);
  } catch (e) {}

  // 4) repair
  try {
    const rs = rd('repair_state.json', { done: {} });
    out.push(`🧹 Wallet yg udah dibenerin (repair): ${Object.keys(rs.done || {}).length}`);
  } catch (e) {}

  // 5) status mesin besar
  try {
    const { execSync } = require('child_process');
    const run = (c) => { try { return execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
    const busy = [];
    if (run("pgrep -f 'finish-all[.]sh'")) busy.push('isi mission (sprint)');
    if (run("pgrep -f 'sell-batch[.]js'")) busy.push('tarik duit (jual token)');
    if (run("pgrep -f 'repair-grab[.]js'")) busy.push('panen ekor (repair)');
    out.push(busy.length ? `🔄 Lagi jalan: ${busy.join(', ')}` : '🔄 Lagi jalan: (semua mesin istirahat)');
  } catch (e) { out.push('🔄 Lagi jalan: ?'); }

  console.log(out.join('\n'));
})().catch((e) => console.log('📋 Laporan error dikit: ' + e.message));
