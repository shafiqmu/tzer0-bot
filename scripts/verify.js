#!/usr/bin/env node
/**
 * verify.js — cek hasil akhir: poin 1.000 wallet + status 14 mission.
 * Cara pakai (root repo, Termux): node scripts/verify.js
 * Output: analysis/verify_report.json + ringkasan di layar. (±4-6 menit)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANALYSIS = path.join(ROOT, 'analysis');
const OUT = path.join(ANALYSIS, 'verify_report.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function main() {
  const wallets = JSON.parse(fs.readFileSync(path.join(ANALYSIS, 'wallets_full.json'), 'utf8'));
  let missions = {};
  const mf = path.join(ANALYSIS, 'missions_14.json');
  if (fs.existsSync(mf)) missions = JSON.parse(fs.readFileSync(mf, 'utf8')).missions || {};

  const report = { wallets: {}, missions: {}, summary: {} };
  let done = 0;
  for (const w of wallets) {
    try {
      const p = await getJSON(`https://testnet.tzer0.fun/api/points/${w}`);
      const b = p.breakdown || {};
      report.wallets[w] = {
        total: p.total ?? p.points ?? null,
        eligible: p.eligible ?? null,
        crew: b.crew ?? p.crew ?? null,
        liftoff: b.liftoff ?? p.liftoff ?? null,
        fuel: b.fuel ?? p.fuel ?? null,
      };
    } catch (e) {
      report.wallets[w] = { error: String(e.message || e) };
    }
    done++;
    if (done % 100 === 0) {
      console.log(`   points: ${done}/${wallets.length}`);
      fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
    }
    await sleep(120);
  }

  for (const [k, m] of Object.entries(missions)) {
    try {
      const d = await getJSON(`https://testnet.tzer0.fun/api/missions/${m.address}`);
      const x = d.mission || d;
      report.missions[k] = { address: m.address, graduated: x.graduated ?? null, progressPercent: x.progressPercent ?? null };
    } catch (e) {
      report.missions[k] = { address: m.address, error: String(e.message || e) };
    }
    await sleep(250);
  }

  const rows = Object.values(report.wallets);
  const totals = rows.map((x) => x.total).filter((x) => typeof x === 'number');
  const crewPts = rows.map((x) => (typeof x.crew === 'number' ? x.crew : null)).filter((x) => x !== null);
  report.summary = {
    checked: rows.length,
    withTotal: totals.length,
    minTotal: totals.length ? Math.min(...totals) : null,
    maxTotal: totals.length ? Math.max(...totals) : null,
    eligible: rows.filter((x) => x.eligible === true).length,
    totalGE600: totals.filter((t) => t >= 600).length,
    totalGE500: totals.filter((t) => t >= 500).length,
    crewPtsGE600: crewPts.filter((c) => c >= 600).length,
    lifted: Object.values(report.missions).filter((m) => m.graduated === true).length,
    missions: Object.keys(missions).length,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(report.summary, null, 1));
  console.log(`\n📄 Detail: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
