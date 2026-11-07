#!/usr/bin/env node
// factory-campaign.js — KAMPANYE pabrik poin: 1 mission penuh per satu, muter terus dari wallet ke wallet
// sampai SEMUA wallet fleet kepake (1000). Urutan per mission: fund wallet window → create mission →
// backer beli → lift → hold → jual → verify → lanjut window berikutnya. Resumable via analysis/campaign_state.json.
// Kill-switch: analysis/STOP (exit), analysis/HOLD (pause).
// Usage: node scripts/factory-campaign.js --run [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const DRY = argv.includes('--dry');
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const LAUNCHPAD = '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c';
let SPARES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'factory_plan.json'), 'utf8')).filter((p) => p.role === 'spare').map((p) => p.addr); } catch (e) { return []; } })(); // top-up pool global (wallet spare dari plan pilot)
const NAMES = [
  ['Cinder Relay', 'CNDR'], ['Harbor Nine', 'HRB9'], ['Vela Works', 'VELA'], ['Kite & Ember', 'KITE'],
  ['Salt Signal', 'SLTS'], ['Emberline', 'EMBR'], ['North Quay', 'NQAY'], ['Glass Harbor', 'GLHR'],
  ['Drift Atlas', 'DRFA'], ['Pale Beacon', 'PLBC'], ['River Kiln', 'RVKL'], ['Amber Vault', 'AMBV'],
  ['Static Garden', 'STGR'], ['Copper Sky', 'CPSK'], ['Iron Meridian', 'IRMD'], ['Slow Comet', 'SLCM'],
  ['Paper Satellites', 'PPSA'], ['Wild Index', 'WLDX'], ['Echo Parcel', 'ECHP'], ['Mariners Ledger', 'MRLG'],
  ['Terracotta Labs', 'TRCL'], ['Night Ferry', 'NTFR'], ['Bright Anvil', 'BRAN'], ['Orbit Almanac', 'ORBA'],
  ['Cedar Circuit', 'CDRC'], ['Quiet Foundry', 'QTFD'], ['Lunar Tides', 'LNRS'], ['Field Notes', 'FLDN'],
  ['Grey Interchange', 'GRIN'], ['Long Dock', 'LDCK'], ['Sunward', 'SLWD'], ['Last Lighthouse', 'LTLH'],
  ['Signal Ridge', 'SRDG'], ['Arc & Ember', 'ARCE'], ['Tidal Ledger', 'TDGR'], ['Polar Foundry', 'PLFD'],
  ['Hollow Vale', 'HLVE'], ['Rivet & Row', 'RVTR'], ['Fallow Bay', 'FLWB'], ['Noon Anchor', 'NNAN'],
];
const PILOT_STATE = path.join(A, 'factory_state.json');
const PILOT_PLAN = path.join(A, 'factory_plan.json');
const CAMPAIGN_STATE = path.join(A, 'campaign_state.json');
const LIFT_NEED = 0.2863; // ETH gross yg dibutuhin buat lift penuh (estimasi; clamp+refund jaga lebih)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
const say = (...xs) => { const l = `[${new Date().toISOString()}] ${xs.join(' ')}`; console.log(l); try { fs.appendFileSync(path.join(ROOT, 'logs', 'campaign.log'), l + '\n'); } catch (e) {} };
const hasProc = (pat) => { try { const o = execSync(`pgrep -f "${pat}"`, { encoding: 'utf8' }).trim(); return o.length > 0; } catch (e) { return false; } };

function loadCampaign() {
  return fs.existsSync(CAMPAIGN_STATE) ? JSON.parse(fs.readFileSync(CAMPAIGN_STATE, 'utf8'))
    : { status: 'waiting-pilot', nextWindow: 0, missions: [], startedAt: Date.now() };
}
function saveCampaign(st) { st.updatedAt = Date.now(); fs.writeFileSync(CAMPAIGN_STATE, JSON.stringify(st, null, 1)); }

// bangun window: wallets yg BELUM kepake (pilot 36 udah), acak ukuran 27-30 per window biar gak seragam
function buildWindows() {
  const wallets = JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map(String);
  const pilotSet = new Set(JSON.parse(fs.readFileSync(PILOT_PLAN, 'utf8')).map((x) => x.addr.toLowerCase()));
  const rest = wallets.filter((w) => !pilotSet.has(w.toLowerCase()));
  const wins = [];
  let i = 0;
  let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  while (i < rest.length) {
    const size = Math.min(rest.length - i, 27 + Math.floor(rnd() * 4)); // 27-30 per window
    wins.push(rest.slice(i, i + size)); i += size;
  }
  return wins;
}

(async () => {
  const wins = buildWindows();
  if (DRY) {
    say(`DRY: ${wins.length} window | ukuran: ${wins.map((w) => w.length).join(',')} | total wallet: ${wins.reduce((a, w) => a + w.length, 0)} + pilot 36 = ${wins.reduce((a, w) => a + w.length, 0) + 36}`);
    return;
  }
  if (!RUN) { say('butuh --run'); return; }
  const st = loadCampaign();

  // ===== PHASE A: tunggu pilot (mission #1) selesai — sekaligus auto-resume kalau pilot mati =====
  if (st.status === 'waiting-pilot') {
    say(`KAMPANYE dimulai: ${wins.length} window + pilot. Fase A: nunggu pilot (mission 1) kelar...`);
    for (;;) {
      if (fs.existsSync(path.join(A, 'STOP'))) { st.status = 'stopped'; saveCampaign(st); say('STOP file — keluar.'); return; }
      let ps = null; try { ps = JSON.parse(fs.readFileSync(PILOT_STATE, 'utf8')); } catch (e) {}
      if (ps && ps.step === 'done') { say('pilot DONE ✅ — lanjut ke window pertama.'); break; }
      if (!hasProc('node scripts/factory-mission[.]js')) {
        say(`pilot gak ada prosesnya (step: ${ps ? ps.step : '?'}) — resume otomatis...`);
        spawnSync('node', ['scripts/factory-mission.js', '--run', '--plan', 'analysis/factory_plan.json', '--state', 'analysis/factory_state.json', '--log', 'logs/factory-1.log', '--name', 'Nimbus Foundry', '--ticker', 'NBFO'], { cwd: ROOT, stdio: 'inherit', timeout: 16200000 });
      }
      await sleep(300000); // cek tiap 5 mnt
    }
    st.status = 'running'; st.nextWindow = 0;
    st.missions.push({ n: 1, name: 'Nimbus Foundry', ticker: 'NBFO', stateFile: 'analysis/factory_state.json', planFile: 'analysis/factory_plan.json', logFile: 'logs/factory-1.log' });
    saveCampaign(st);
  }

  // ===== PHASE B: loop window =====
  while (st.nextWindow < wins.length) {
    if (fs.existsSync(path.join(A, 'STOP'))) { st.status = 'stopped'; saveCampaign(st); say('STOP file — kampanye berhenti.'); return; }
    while (fs.existsSync(path.join(A, 'HOLD'))) { say('HOLD aktif — pause 10 mnt...'); await sleep(600000); }

    const wi = st.nextWindow;
    const chunk = wins[wi];
    if (chunk.length < 2) { // wallet sisa tunggal → jadikan spare pool, skip window
      if (chunk[0]) SPARES.push(chunk[0]);
      st.nextWindow++; saveCampaign(st);
      continue;
    }
    const nBackers = Math.max(1, chunk.length - 1);
    const creator = chunk[0];
    const backers = chunk.slice(1);
    const buy = Math.max(0.01, Math.min(0.5, LIFT_NEED / nBackers));
    const [name, ticker] = NAMES[wi % NAMES.length];
    const mN = wi + 2;
    const planFile = `analysis/campaign_m${mN}_plan.json`;
    const fundFile = `analysis/campaign_m${mN}_fund.json`;
    const stateFile = `analysis/factory_m${mN}_state.json`;
    const logFile = `logs/factory_m${mN}.log`;

    say(`── WINDOW ${wi + 1}/${wins.length} (mission #${mN}: ${name}/${ticker}) | ${chunk.length} wallet | buy ≈ ${fmt(buy)} ──`);
    // plan mission
    fs.writeFileSync(path.join(ROOT, planFile), JSON.stringify([
      { role: 'creator', addr: creator },
      ...backers.map((b) => ({ role: 'backer', addr: b })),
      ...SPARES.map((s) => ({ role: 'spare', addr: s })),
    ], null, 1));
    // plan funding (want = buy + buffer; creator fee+gas; spares top-up)
    fs.writeFileSync(path.join(ROOT, fundFile), JSON.stringify([
      { addr: creator, want: '0.0028' },
      ...backers.map((b) => ({ addr: b, want: fmt(buy + 0.0015) })),
      ...SPARES.map((s) => ({ addr: s, want: '0.0055' })),
    ], null, 1));

    // fund dulu
    say(`funding window ${mN}...`);
    spawnSync('node', ['scripts/consolidate.js', '--plan', fundFile, '--run'], { cwd: ROOT, stdio: 'inherit', timeout: 1800000 });
    await sleep(10000);

    // jalanin mission (blocking sampai semua step kelar)
    let okMission = false;
    for (let attempt = 1; attempt <= 2 && !okMission; attempt++) {
      const r = spawnSync('node', ['scripts/factory-mission.js', '--run', '--plan', planFile, '--state', stateFile, '--log', logFile, '--name', name, '--ticker', ticker, '--buyeth', fmt(buy)], { cwd: ROOT, stdio: 'inherit', timeout: 16200000 });
      let ms = null; try { ms = JSON.parse(fs.readFileSync(path.join(ROOT, stateFile), 'utf8')); } catch (e) {}
      if (ms && ms.step === 'done') okMission = true;
      else say(`window ${mN} attempt ${attempt} BELUM done (step: ${ms ? ms.step : '?'}), retry...`);
      await sleep(15000);
    }
    let ms = null; try { ms = JSON.parse(fs.readFileSync(path.join(ROOT, stateFile), 'utf8')); } catch (e) {}
    st.missions.push({ n: mN, name, ticker, stateFile, planFile, logFile, ok: okMission, points: ms && ms.totalPoints, mission: ms && ms.mission, doneAt: Date.now() });
    st.nextWindow++;
    saveCampaign(st);
    if (!okMission) { st.status = 'stuck'; saveCampaign(st); say(`⚠️ window ${mN} macet — kampanye stop biar dicek (state tersimpan).`); fs.writeFileSync(path.join(A, 'CAMPAIGN_STUCK'), String(mN)); return; }
    say(`window ${mN} KELAR ✅ (poin peserta ≈ ${ms ? ms.totalPoints : '?'}). Lanjut...`);
    await sleep(20000);
  }

  st.status = 'done'; saveCampaign(st);
  const totalPts = st.missions.reduce((a, m) => a + (Number(m.points) || 0), 0);
  say(`=== KAMPANYE SELESAI: ${st.missions.length} mission | total poin wallet peserta ≈ ${totalPts} ===`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
