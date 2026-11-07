#!/usr/bin/env node
// sell-batch.js — orkestrator SWEEP JUAL massal pasca-lift (fase loop daur-ulang).
// Menjalankan scripts/sell-token.js per target (wallet, mission); resumable; anti-bentrok dengan mesin lain.
// Usage: node scripts/sell-batch.js [--run] [--max N] [--min-delay 3 --max-delay 8]
// State: analysis/sell_state.json  {done: {key: {amt, tx}}, empty: {key: true}, fail: {key: err}}
// Guard: file STOP → stop. Ada finish-all/fill-runner/repair-grab jalan → tunggu (poll 60 dtk).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const MODE = argv.includes('--run') ? 'run' : 'dry';
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const MIN_D = Number(arg('--min-delay', 3));
const MAX_D = Number(arg('--max-delay', 8));
const MAX = Number(arg('--max', 0)) || Infinity;
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => fs.writeFileSync(path.join(A, f), JSON.stringify(o));

function busy(names) {
  for (const n of names) {
    try { const r = spawnSync('pgrep', ['-f', n], { encoding: 'utf8' }); if (r.stdout && r.stdout.trim()) return n; } catch (e) {}
  }
  return null;
}

(async () => {
  const targets = rd('sell_targets.json', []);
  if (!targets.length) { console.log('sell_targets.json kosong — jalanin build-sell-targets.js dulu'); return; }
  const state = rd('sell_state.json', { done: {}, empty: {}, fail: {} });
  let sent = 0, empty = 0, fail = 0, recovered = 0n;
  const { ethers } = require('ethers');
  const provider = new ethers.JsonRpcProvider(RPC);

  for (const t of targets) {
    if (sent + empty + fail >= MAX) break;
    if (fs.existsSync(path.join(A, 'STOP'))) { console.log('STOP file — berhenti.'); break; }
    if (fs.existsSync(path.join(A, 'HOLD'))) { console.log('HOLD file — tunggu 60 dtk...'); await sleep(60000); continue; }
    const key = t.wallet.toLowerCase() + '|' + String(t.mission).toLowerCase();
    if (state.done[key] || state.empty[key]) continue;
    // tunggu mesin lain selesai biar nonce gak tabrakan (dry: skip nunggu)
    if (MODE === 'run') {
      let b = busy(['finish-all.sh', 'fill-runner.js', 'repair-grab.js']);
      let waited = 0;
      while (b && waited < 10800) {
        if (waited === 0) console.log(`⏳ nunggu mesin lain selesai (${b})...`);
        await sleep(60000); waited += 60;
        if (fs.existsSync(path.join(A, 'STOP'))) return;
        b = busy(['finish-all.sh', 'fill-runner.js', 'repair-grab.js']);
      }
    } else {
      const b = busy(['finish-all.sh', 'fill-runner.js', 'repair-grab.js']);
      if (b) console.log('(dry) mesin lain jalan:', b);
    }
    if (MODE === 'dry') { console.log('dry target:', t.wallet.slice(0, 10), '×', String(t.mission).slice(0, 10)); continue; }
    const eth0 = await provider.getBalance(t.wallet);
    const r = spawnSync('node', ['scripts/sell-token.js', '--wallet', t.wallet, '--mission', t.mission, '--run'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const last = out.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
    if (/DONE ✅/.test(out)) {
      const eth1 = await provider.getBalance(t.wallet);
      const gain = eth1 - eth0;
      recovered += gain;
      state.done[key] = { ts: Date.now(), gainWei: gain.toString(), out: last.slice(0, 120) };
      sent++;
      console.log(`💸 ${sent} jual ok | ${t.wallet.slice(0, 10)}×${String(t.mission).slice(0, 10)} | +${ethers.formatEther(gain)} ETH`);
    } else if (/saldo 0|gak ada yg dijual/.test(out)) {
      state.empty[key] = true; empty++;
    } else {
      state.fail[key] = { ts: Date.now(), err: last.slice(0, 200) };
      fail++;
      console.log(`⚠️ fail | ${t.wallet.slice(0, 10)}×${String(t.mission).slice(0, 10)} | ${last.slice(0, 90)}`);
    }
    wr('sell_state.json', state);
    await sleep((MIN_D + Math.random() * Math.max(0, MAX_D - MIN_D)) * 1000);
  }
  console.log(`\n🏁 Sweep selesai: jual ${sent} | kosong ${empty} | gagal ${fail} | recovery ≈ ${ethers ? ethers.formatEther(recovered) : recovered} ETH`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
