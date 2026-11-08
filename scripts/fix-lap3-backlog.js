#!/usr/bin/env node
// fix-lap3-backlog.js — tambal 11 mission lap 3 yang nyangkut gara-gara kas kering pas produksi.
// FASE A: top-up pemicu utk [80,81,82,84,86] (udah kebeli sebagian) → line lift + jual → duit balik.
// FASE B: redo penuh [77,78,79,83,85,87] (refill → seed beli → tunggu umur 62 mnt → fund pemicu).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { ethers } = require(path.join(ROOT, 'node_modules', 'ethers'));
const p = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
const lp = new ethers.Contract('0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c', ['function curve(address) view returns (address,uint256,bool,address,uint256,uint256,uint256,uint256)'], p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const say = (...x) => console.log(`[fixl3 ${new Date().toISOString()}]`, ...x);
const TOPUP = [80, 81, 82, 84, 86];
const REDO = [77, 78, 79, 83, 85, 87];
const SPARES = readJson(path.join(A, 'factory_plan.json')).filter((x) => x.role === 'spare').map((x) => x.addr.toLowerCase());

const hasProc = (...needles) => {
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    try { const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); if (needles.every((n) => cm.includes(n))) return true; } catch (e) {}
  }
  return false;
};

function missionInfo(n) {
  const st = readJson(path.join(A, `factory_m${n}_state.json`));
  const pl = readJson(path.join(A, `line_m${n}_plan.json`));
  const bk = pl.filter((x) => x.role === 'backer');
  const trig = bk[bk.length - 1].addr;
  return { st, pl, trig, planFile: `analysis/line_m${n}_plan.json`, stateFile: `analysis/factory_m${n}_state.json` };
}

function bridgeExcl() {
  // exclude: spares + SEMUA wallet mission lap3 yang aktif (aged/trigger/seeding) — biar gak kegempes jadi donor
  const ex = new Set(SPARES);
  try {
    const s3 = readJson(path.join(A, 'line_state3.json'));
    for (const m of s3.missions || []) {
      if (['aged', 'trigger', 'seeding'].includes(m.phase)) for (const w of m.wallets) ex.add(w.toLowerCase());
    }
  } catch (e) {}
  return [...ex].join('\n');
}

function runConsolidate(plan, tag) {
  const planPath = path.join(A, `fixl3_${tag}_plan.json`);
  const exclPath = path.join(A, `fixl3_${tag}_excl.txt`);
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 1));
  fs.writeFileSync(exclPath, bridgeExcl());
  const r = spawnSync('node', ['scripts/consolidate.js', '--plan', planPath, '--run', '--exclude', exclPath], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const shorts = [...out.matchAll(/kurang ([\d.]+) ETH/g)].map((x) => Number(x[1]));
  const short = shorts.reduce((a, b) => a + b, 0);
  say(`${tag}: ${out.split('\n').filter((l) => /SELESAI|KURANG|kebutuhan riil|donor terkumpul/.test(l)).join(' | ').slice(0, 320)}`);
  return short;
}

(async () => {
  say(`MULAI. top-up: [${TOPUP}] | redo: [${REDO}]`);
  // ---------- FASE A: top-up pemicu partials ----------
  for (const n of TOPUP) {
    try {
      let info;
      try { info = missionInfo(n); } catch (e) { say(`#${n} skip (file kurang)`); continue; }
      const c = await lp.curve(info.st.mission);
      if (c[2]) { say(`#${n}: udah graduated — skip top-up.`); continue; }
      const real = Number(ethers.formatEther(c[6]));
      const want = ((0.28335 - real) * 1.12) / 0.99 + 0.0015;
      const bal = Number(ethers.formatEther(await p.getBalance(info.trig)));
      const diff = want - bal;
      if (diff <= 0.002) { say(`#${n}: pemicu cukup (${bal.toFixed(5)}/${want.toFixed(5)}) — skip.`); continue; }
      say(`#${n}: top-up pemicu +${diff.toFixed(5)} (bal ${bal.toFixed(5)} → butuh ${want.toFixed(5)})`);
      let ok = false;
      for (let t = 1; t <= 6 && !ok; t++) {
        const short = runConsolidate([{ addr: info.trig, want: diff.toFixed(6) }], `top${n}_${t}`);
        if (short <= 0.002) ok = true; else await sleep(90000);
      }
      say(`#${n}: top-up ${ok ? 'OK ✅' : 'belum — dikejar nanti'}`);
    } catch (e) { say(`#${n} ERR ${e.message}`); }
  }

  // ---------- FASE B: refill gabungan utk redo ----------
  const refillPlan = [];
  for (const n of REDO) {
    try {
      const fund = readJson(path.join(A, `line_m${n}_fund.json`));
      const info = missionInfo(n);
      const trigLc = info.trig.toLowerCase();
      for (const x of fund) if (x.addr.toLowerCase() !== trigLc) refillPlan.push(x);
      say(`redo #${n}: ${fund.length - 1} target refill dikumpulin`);
    } catch (e) { say(`#${n} fund ERR ${e.message}`); }
  }
  say(`FASE B refill gabungan: ${refillPlan.length} target`);
  let funded = false;
  for (let t = 1; t <= 12 && !funded; t++) {
    const short = runConsolidate(refillPlan, `refill_${t}`);
    if (short <= 0.01) funded = true; else { say(`refill kurang ${short.toFixed(3)} — tunggu 2 mnt (nunggu duit lift balik)...`); await sleep(120000); }
  }
  say(`FASE B refill ${funded ? 'LENGKAP ✅' : 'sebagian — lanjut apa adanya'}`);

  // ---------- FASE B2: seed (beli) tiap redo, stagger ----------
  for (const n of REDO) {
    try {
      const info = missionInfo(n);
      let st = info.st;
      const nBuy = Object.keys(st.buys || {}).length;
      if (nBuy >= 20) { say(`redo #${n}: udah ${nBuy} beli — skip seed.`); continue; }
      for (const pid of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          const cm = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
          if (cm.includes('--phase trigger') && cm.includes(`line_m${n}_plan`)) { process.kill(Number(pid), 'SIGTERM'); say(`#${n}: kill trigger-child ${pid}`); }
        } catch (e) {}
      }
      fs.writeFileSync(path.join(A, 'HOLD'), '');
      st = readJson(path.join(A, `factory_m${n}_state.json`));
      if (st.step !== 'phaseA') { st.step = 'phaseA'; fs.writeFileSync(path.join(A, `factory_m${n}_state.json`), JSON.stringify(st, null, 1)); }
      const out = fs.openSync(path.join(ROOT, `logs/line_m${n}.log`), 'a');
      spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', info.planFile, '--state', info.stateFile, '--log', `logs/line_m${n}.log`, '--name', (st.name || `M${n}`), '--ticker', (st.ticker || `M${n}`)], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] }).unref();
      setTimeout(() => { try { fs.unlinkSync(path.join(A, 'HOLD')); } catch (e) {} }, 4000);
      say(`redo #${n}: seed-child di-spawn (beli fase A).`);
      await sleep(45000);
    } catch (e) { say(`#${n} seed ERR ${e.message}`); }
  }

  // ---------- FASE C: tunggu umur lalu fund pemicu ----------
  say('FASE C: nunggu umur beli ≥62 mnt utk funding pemicu...');
  for (const n of REDO) {
    try {
      for (;;) {
        const info = missionInfo(n);
        const st = info.st;
        const ts = Math.max(0, ...Object.values(st.buys || {}).map((x) => x.ts || 0));
        const nBuy = Object.keys(st.buys || {}).length;
        if (nBuy === 0) { say(`#${n}: beli 0 — skip (dikejar manual).`); break; }
        const c = await lp.curve(st.mission);
        if (c[2]) { say(`#${n}: graduated ✅ — lewat.`); break; }
        const ageM = (Date.now() - ts) / 60000;
        if (ageM < 62) { await sleep(60000); continue; }
        const real = Number(ethers.formatEther(c[6]));
        const want = ((0.28335 - real) * 1.12) / 0.99 + 0.0015;
        say(`#${n}: umur ${ageM.toFixed(0)}m — fund pemicu ${want.toFixed(5)}`);
        let ok = false;
        for (let t = 1; t <= 6 && !ok; t++) {
          const short = runConsolidate([{ addr: info.trig, want: want.toFixed(6) }], `trig${n}_${t}`);
          if (short <= 0.002) ok = true; else await sleep(60000);
        }
        say(`#${n}: fund pemicu ${ok ? 'OK ✅ (line bakal lift)' : 'gagal — dikejar nanti'}`);
        break;
      }
    } catch (e) { say(`#${n} faseC ERR ${e.message}`); }
  }
  say('SEMUA FASE KELAR — line yang lift + jualin. (script selesai)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
