#!/usr/bin/env node
// factory-line.js — JALUR PIPA CEPAT: 1 mission di-BURST (diisi penuh) pada satu waktu,
// tapi beberapa mission berikutnya "dipanasi" (seed 6 backer) bareng — umur 60-menitnya jalan paralel.
// Hasil: burst tiap ~7-10 menit begitu jalan → 35 mission ≈ 6-8 jam (bukan 4-5 hari).
// Alur per mission: fund → create (+6 seed beli) → [umur 61 mnt, diem di background] → burst 23 beli → LIFT → jual pas umurnya → verify.
// Kill-switch: analysis/STOP (exit), analysis/HOLD (pause). State: analysis/line_state.json.
// Usage: node scripts/factory-line.js --run [--dry]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn, execSync } = require('child_process');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'analysis');
const argv = process.argv.slice(2);
const RUN = argv.includes('--run');
const DRY = argv.includes('--dry');
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const LATEST_NEED = 0.30; // ETH gross target per mission (kebutuhan lift ≈0.2863 + margin; sisa direfund kontrak)
const EARLY = 6;           // jumlah backer "pemanasan" per mission
const MAX_QUEUE = 6;       // maks mission dipanasin bareng
const AGE_MS = 61 * 60000; // umur minimum seed sebelum burst (60 mnt + buffer)
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
const LINE_STATE = path.join(A, 'line_state.json');
const PILOT_STATE = path.join(A, 'factory_state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
const say = (...xs) => console.log(`[${new Date().toISOString()}] ${xs.join(' ')}`);
const hasProc = (pat) => { try { return execSync(`pgrep -f "${pat}"`, { encoding: 'utf8' }).trim().length > 0; } catch (e) { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

function loadLine() {
  return readJson(LINE_STATE) || { status: 'waiting-pilot', nextWindow: 0, missions: [], startedAt: Date.now() };
}
function saveLine(st) { st.updatedAt = Date.now(); fs.writeFileSync(LINE_STATE, JSON.stringify(st, null, 1)); }

function buildWindows() {
  const wallets = JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map(String);
  const pilotSet = new Set(JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8')).map((x) => x.addr.toLowerCase()));
  const rest = wallets.filter((w) => !pilotSet.has(w.toLowerCase()));
  const wins = [];
  let i = 0; let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  while (i < rest.length) { const size = Math.min(rest.length - i, 27 + Math.floor(rnd() * 4)); wins.push(rest.slice(i, i + size)); i += size; }
  return wins;
}
const SPARES = (() => { try { return JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8')).filter((p) => p.role === 'spare').map((p) => p.addr); } catch (e) { return []; } })();

(async () => {
  const wins = buildWindows();
  if (DRY) { say(`DRY: ${wins.length} window | ${wins.map((w) => w.length).join(',')} | total ${wins.reduce((a, w) => a + w.length, 0)} + pilot 36`); return; }
  if (!RUN) { say('butuh --run'); return; }
  const st = loadLine();
  // restart-safe: mission yg fase-nya nyangkut 'seeding' (proses mati mid-produksi) → ulang dari window itu
  // (fund idempotent, create di-skip via state file, seed beli yg udah jalan di-skip)
  const bad = st.missions.filter((m) => m.phase === 'seeding' || m.phase === 'stuck');
  if (bad.length) { st.missions = st.missions.filter((m) => m.phase !== 'seeding' && m.phase !== 'stuck'); st.nextWindow = Math.max(0, st.nextWindow - bad.length); saveLine(st); }

  // === FASE 0: tunggu pilot LIFTED (state wait2/sell/verify/done) + auto-resume pilot kalau mati ===
  if (st.status === 'waiting-pilot') {
    say(`JALUR PIPA start: ${wins.length} window + pilot. Nunggu pilot lift dulu...`);
    for (;;) {
      if (fs.existsSync(path.join(A, 'STOP'))) { st.status = 'stopped'; saveLine(st); say('STOP — keluar.'); return; }
      const ps = readJson(PILOT_STATE);
      const lifted = ps && ['wait2', 'sell', 'verify', 'done'].includes(ps.step);
      if (lifted) { say(`pilot LIFTED (step ${ps.step}) ✅ — mulai produksi.`); break; }
      if (!hasProc('factory-mission[.]js --run$')) {
        say(`pilot gak ada prosesnya (step: ${ps ? ps.step : '?'}) — resume...`);
        spawnSync('node', ['scripts/factory-mission.js', '--run', '--phase', 'full', '--plan', 'analysis/factory_plan.json', '--state', 'analysis/factory_state.json', '--log', 'logs/factory-1.log', '--name', 'Nimbus Foundry', '--ticker', 'NBFO'], { cwd: ROOT, stdio: 'inherit', timeout: 16200000 });
      }
      await sleep(60000);
    }
    st.status = 'running'; saveLine(st);
  }

  // === FASE 1: loop produksi ===
  if (st.status !== 'running' && st.status !== 'done' && st.status !== 'stopped') { st.status = 'running'; saveLine(st); }
  let stallTicks = 0;
  for (;;) {
    if (fs.existsSync(path.join(A, 'STOP'))) { st.status = 'stopped'; saveLine(st); say('STOP — jalur berhenti.'); return; }
    if (fs.existsSync(path.join(A, 'HOLD'))) { await sleep(30000); continue; }

    // -- sinkron status mission dari state file --
    for (const m of st.missions) {
      if (m.phase === 'burst') {
        const ms = readJson(path.join(ROOT, m.stateFile));
        if (ms && ms.step === 'done') {
          m.phase = 'settled'; m.ok = true; m.points = ms.totalPoints; m.mission = ms.mission; m.settledTs = Date.now();
          saveLine(st);
          say(`MISSION #${m.n} (${m.name}) SELESAI ✅ poin ≈ ${ms.totalPoints}`);
        } else if (Date.now() - (m.burstTs || 0) > 5 * 60000 && !hasProc(`factory_m${m.n}_state`)) {
          say(`⚠️ #${m.n} burst-child mati di step ${ms ? ms.step : '?'} — resume...`);
          const out = fs.openSync(path.join(ROOT, m.logFile), 'a');
          const c = spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'burst', '--plan', m.planFile, '--state', m.stateFile, '--log', m.logFile, '--name', m.name, '--ticker', m.ticker, '--buyeth', String(m.buy)], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
          c.unref();
        }
      }
    }

    // -- B: BURST mission paling tua yang umurnya udah 61+ mnt (satu-satu) --
    const bursting = st.missions.some((m) => m.phase === 'burst');
    if (!bursting) {
      const cand = st.missions.find((m) => m.phase === 'seeded' && Date.now() - m.seededTs >= AGE_MS);
      if (cand) {
        cand.phase = 'burst'; cand.burstTs = Date.now(); saveLine(st);
        say(`BURST #${cand.n} (${cand.name}) — ${cand.wallets.length} wallet, umur ${((Date.now() - cand.seededTs) / 60000).toFixed(1)} mnt 🚀`);
        const out = fs.openSync(path.join(ROOT, cand.logFile), 'a');
        const c = spawn('node', ['scripts/factory-mission.js', '--run', '--phase', 'burst', '--plan', cand.planFile, '--state', cand.stateFile, '--log', cand.logFile, '--name', cand.name, '--ticker', cand.ticker, '--buyeth', String(cand.buy)], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
        c.unref();
      }
    }

    // -- A: PRODUKSI mission berikutnya (fund → create + seed) kalau antrian belum penuh --
    const seeding = st.missions.some((m) => m.phase === 'seeding');
    const queue = st.missions.filter((m) => m.phase === 'seeded').length;
    if (!seeding && queue < MAX_QUEUE && st.nextWindow < wins.length) {
      const wi = st.nextWindow;
      const chunk = wins[wi];
      const mN = wi + 2;
      const nBackers = Math.max(1, chunk.length - 1);
      const creator = chunk[0];
      const backers = chunk.slice(1);
      const buy = Math.max(0.01, Math.min(0.5, LATEST_NEED / nBackers));
      const [name, ticker] = NAMES[wi % NAMES.length];
      const planFile = `analysis/line_m${mN}_plan.json`;
      const fundFile = `analysis/line_m${mN}_fund.json`;
      const stateFile = `analysis/factory_m${mN}_state.json`;
      const logFile = `logs/line_m${mN}.log`;
      const exclFile = `analysis/line_m${mN}_exclude.txt`;

      const m = { n: mN, name, ticker, wallets: chunk, planFile, fundFile, stateFile, logFile, buy, phase: 'seeding', createdTs: Date.now() };
      st.missions.push(m); st.nextWindow++; saveLine(st);
      say(`── PRODUKSI #${mN} (${name}/${ticker}) | ${chunk.length} wallet | buy ≈ ${fmt(buy)} ──`);

      fs.writeFileSync(path.join(ROOT, planFile), JSON.stringify([
        { role: 'creator', addr: creator },
        ...backers.map((b) => ({ role: 'backer', addr: b })),
        ...SPARES.map((s) => ({ role: 'spare', addr: s })),
      ], null, 1));
      fs.writeFileSync(path.join(ROOT, fundFile), JSON.stringify([
        { addr: creator, want: '0.0028' },
        ...backers.map((b) => ({ addr: b, want: fmt(buy + 0.0015) })),
        ...SPARES.map((s) => ({ addr: s, want: '0.0055' })),
      ], null, 1));
      // exclude: wallet mission yang BELUM burst (duitnya jangan diambil) + spares
      const excl = new Set(SPARES.map((x) => x.toLowerCase()));
      for (const mm of st.missions) if (['seeding', 'seeded', 'burst'].includes(mm.phase)) for (const w of mm.wallets) excl.add(w.toLowerCase());
      fs.writeFileSync(path.join(ROOT, exclFile), [...excl].join('\n'));

      say(`funding #${mN}...`);
      let funded = false;
      for (let tr = 1; tr <= 10 && !funded; tr++) {
        const fr = spawnSync('node', ['scripts/consolidate.js', '--plan', fundFile, '--run', '--exclude', exclFile], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
        const fOut = (fr.stdout || '') + (fr.stderr || '');
        process.stdout.write(fOut);
        const shorts = [...fOut.matchAll(/kurang ([\d.]+) ETH/g)].map((x) => Number(x[1]));
        const shortTotal = shorts.reduce((a, b) => a + b, 0);
        const gm = /SELESAI: (\d+) ok \| (\d+) gagal/.exec(fOut);
        const gFail = gm ? Number(gm[2]) : 0;
        if (shortTotal <= 0.004 && gFail === 0) funded = true;
        else { say(`funding #${mN} kurang ${shortTotal.toFixed(4)} ETH / ${gFail} tx gagal — tunggu 75s (duit dari jualan balik)... [${tr}/10]`); await sleep(75000); }
      }
      if (!funded) say(`⚠️ funding #${mN} pas-pasan — lanjut (spare & refund jaga).`);
      await sleep(4000);
      say(`create + seed #${mN}...`);
      spawnSync('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', planFile, '--state', stateFile, '--log', logFile, '--name', name, '--ticker', ticker, '--buyeth', fmt(buy)], { cwd: ROOT, stdio: 'inherit', timeout: 1800000 });
      const ms = readJson(path.join(ROOT, stateFile));
      if (ms && (ms.step === 'seeded' || ms.step === 'late' || ms.step === 'sell')) {
        m.phase = 'seeded'; m.seededTs = Date.now(); m.mission = ms.mission; saveLine(st);
        say(`#${mN} SEEDED ✅ (umur jalan) | mission ${ms.mission}`);
      } else {
        m.phase = 'stuck'; saveLine(st);
        say(`⚠️ #${mN} seed gagal (step ${ms ? ms.step : '?'}) — jalur pause.`);
        fs.writeFileSync(path.join(A, 'LINE_STUCK'), String(mN));
        st.status = 'stuck'; saveLine(st);
        return;
      }
    }

    // -- selesai semua? --
    const active = st.missions.some((m) => ['seeding', 'seeded', 'burst'].includes(m.phase));
    if (st.nextWindow >= wins.length && !active) {
      st.status = 'done'; saveLine(st);
      const pts = st.missions.reduce((a, m) => a + (Number(m.points) || 0), 0);
      say(`=== JALUR PIPA SELESAI: ${st.missions.length} mission (+pilot) | poin ≈ ${pts} ===`);
      return;
    }
    // -- deteksi macet: produksi stop & gak ada yg aktif (queue kosong, no seed, no burst) padahal window sisa --
    const anyActive = st.missions.some((m) => ['seeding', 'seeded', 'burst'].includes(m.phase));
    const newestTs = st.missions.reduce((a, m) => Math.max(a, m.createdTs || 0, m.seededTs || 0, m.burstTs || 0), 0);
    if (!anyActive && st.nextWindow < wins.length && Date.now() - Math.max(newestTs, st.startedAt || 0) > 20 * 60000) {
      say('⚠️ produksi diam 20 mnt — pause biar dicek.'); st.status = 'stuck'; saveLine(st); fs.writeFileSync(path.join(A, 'LINE_STUCK'), 'stall'); return;
    }

    await sleep(20000);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
