#!/usr/bin/env node
// factory-line.js v3.2 — JALUR "FASE A + PEMICU" + MODE TURBO:
//   - PEMICU PARALEL ×MAX_TRIG (wallet beda mission — aman; dulu satu-satu = rem utama)
//   - SEED ASYNC (produksi gak ngeblok antrian pemicu)
//   - Queue 6 (frozen capital ≥ queue×0.28 ETH)
//   - Sell + beli fase A PARALEL (dikerjakan di factory-mission.js v3.2)
//   Alur tiap mission: fund → create + FASE A → [aged 61 mnt] → PEMICU → jual → settle.
//   Kill-switch: analysis/STOP (exit), analysis/HOLD (pause).
//   State: analysis/line_state.json (lap 1) / analysis/line_state2.json (--lap2).
// Usage: node scripts/factory-line.js --run [--dry] [--lap2]
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
const LAP = argv.includes('--lap4') ? 4 : argv.includes('--lap3') ? 3 : argv.includes('--lap2') ? 2 : 1; // puteran: shuffle+nama beda tiap lap, mN lanjut
const LAP2 = LAP === 2; // mode lap-2 (dipertahankan buat kompat)
const RPC = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const A_BUY = 0.0114;        // beli Fase A (≥0.01; 0.0114 → fill ~97% biar gak disamber bot completer)
const MAXA = 27;             // maks wallet fase A
const LIFT_NET = 0.28335;    // kebutuhan liftoff (net, ETH)
const MAX_QUEUE = LAP >= 3 ? 5 : 6; // maks mission "aged" nunggu bareng (lap 3+: 5 — kas ketat, antrian lama harus kelar dulu)
const MAX_TRIG = 5;          // TURBO: pemicu paralel ×5 (wallet beda — aman; 3→5 biar antrian gak nyumbat)
const AGE_MS = 61 * 60000;   // umur minimum fase A sebelum pemicu
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
const NAMES2 = [
  ['Ochre Summit', 'OCSM'], ['Velvet Quarry', 'VLQR'], ['Salt Meadow', 'SLMD'], ['Blue Kiln', 'BLKL'],
  ['Mercury Tide', 'MCYT'], ['Old Station', 'OLST'], ['Ferro Grove', 'FRGR'], ['Tin Lantern', 'TNLT'],
  ['Misty Wharf', 'MSWH'], ['Bronze Echo', 'BRZE'], ['Gemini Rocks', 'GMRO'], ['Silver Meadow', 'SVMD'],
  ['Ash Compass', 'ASCO'], ['Coral Engine', 'CREN'], ['Dust Harbor', 'DSHB'], ['Lunar Depot', 'LNDP'],
  ['Velvet Anvil', 'VLAN'], ['Summit Line', 'SMLN'], ['Willow Reactor', 'WLRX'], ['Onyx Signal', 'ONSG'],
  ['Copper Delta', 'CPDL'], ['Jute & Steel', 'JTST'], ['Iron Orchard', 'IROR'], ['Slow Harbor', 'SLHB'],
  ['Pale Trek', 'PLTK'], ['Nova Basket', 'NVBK'], ['Echo Bastion', 'ECBS'], ['Drift Beacon', 'DRBC'],
  ['Quiet Reactor', 'QTRX'], ['Amber Monsoon', 'AMMN'], ['Static Pier', 'STPR'], ['Glass Foundry', 'GLFD'],
  ['River Antenna', 'RVAN'], ['Meadow Circuit', 'MDCR'], ['Cobalt Fields', 'CBFD'], ['Rust & Radar', 'RSRD'],
  ['Hazel Engine', 'HZEN'], ['Orbit Fields', 'ORFD'], ['Solstice Works', 'SLWK'], ['Bramble Line', 'BRML'],
];
const NAMESEL = LAP2 ? NAMES2 : NAMES;
const FIRSTS = [...new Set(NAMES2.map((n) => n[0].split(' ')[0]))];
const SECONDS = [...new Set(NAMES2.map((n) => n[0].split(' ').slice(-1)[0]))];
const genName = (wi, lap) => { const f = FIRSTS[(wi + lap * 7) % FIRSTS.length]; const s = SECONDS[(wi * 5 + lap * 11) % SECONDS.length]; return [f + ' ' + s, (f.slice(0, 2) + s.slice(0, 2)).toUpperCase()]; };
const LINE_STATE = path.join(A, LAP > 1 ? `line_state${LAP}.json` : 'line_state.json');
const PILOT_STATE = path.join(A, 'factory_state.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
const say = (...xs) => console.log(`[${new Date().toISOString()}] ${xs.join(' ')}`);
const hasProc = (pat) => { try { return execSync(`pgrep -f "${pat}"`, { encoding: 'utf8' }).trim().length > 0; } catch (e) { return false; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };
const ACTIVE_PHASES = ['seeding', 'aged', 'trigger'];

function loadLine() {
  return readJson(LINE_STATE) || { status: 'waiting-pilot', nextWindow: 0, missions: [], startedAt: Date.now() };
}
function saveLine(st) { st.updatedAt = Date.now(); fs.writeFileSync(LINE_STATE, JSON.stringify(st, null, 1)); }

function buildWindows() {
  const wallets = JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map(String);
  const pilotPlan = JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8')).map((x) => x.addr);
  const pilotSet = new Set(pilotPlan.map((x) => x.toLowerCase()));
  let rest; let seed;
  if (LAP > 1) {
    // LAP 2+: shuffle SEMUA 1000 wallet (wallets_full udah termasuk 36 pilot) — grup + peran beda tiap puteran
    rest = [...wallets];
    seed = LAP === 2 ? 777 : 776 + LAP; // lap2=777, lap3=779, lap4=780 — tiap lap beda urutan
    for (let j = rest.length - 1; j > 0; j--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const k = seed % (j + 1);
      const t = rest[j]; rest[j] = rest[k]; rest[k] = t;
    }
  } else {
    rest = wallets.filter((w) => !pilotSet.has(w.toLowerCase()));
    seed = 42;
  }
  const wins = [];
  let i = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  while (i < rest.length) { const size = Math.min(rest.length - i, 27 + Math.floor(rnd() * 4)); wins.push(rest.slice(i, i + size)); i += size; }
  return wins;
}
const SPARES = (() => { try { return JSON.parse(fs.readFileSync(path.join(A, 'factory_plan.json'), 'utf8')).filter((p) => p.role === 'spare').map((p) => p.addr); } catch (e) { return []; } })();
const spawnDetached = (args, logFile) => {
  const out = fs.openSync(path.join(ROOT, logFile), 'a');
  const c = spawn('node', args, { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
  c.unref();
};

(async () => {
  const wins = buildWindows();
  if (DRY) { say(`DRY${LAP > 1 ? ' LAP ' + LAP : ''}: ${wins.length} window | ${wins.map((w) => w.length).join(',')} | total ${wins.reduce((a, w) => a + w.length, 0)}`); return; }
  if (!RUN) { say('butuh --run'); return; }
  const st = loadLine();
  // migrasi nama fase v2 → v3 (seeded→aged, burst→trigger) + restart-safe (seeding/stuck diulang)
  for (const m of st.missions) { if (m.phase === 'seeded') m.phase = 'aged'; if (m.phase === 'burst') m.phase = 'trigger'; }
  const bad = st.missions.filter((m) => m.phase === 'seeding' || m.phase === 'stuck');
  if (bad.length) { st.missions = st.missions.filter((m) => m.phase !== 'seeding' && m.phase !== 'stuck'); st.nextWindow = Math.max(0, st.nextWindow - bad.length); saveLine(st); }

  // === FASE 0: tunggu pilot LIFTED + auto-resume pilot kalau mati ===
  if (LAP >= 3 && st.status === 'waiting-pilot') { st.status = 'running'; saveLine(st); say(`LAP ${LAP}: skip nunggu pilot — langsung produksi.`); }
  if (st.status === 'waiting-pilot') {
    say(`JALUR v3.2${LAP > 1 ? ' LAP ' + LAP : ''} start: ${wins.length} window + pilot. Nunggu pilot lift dulu...`);
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
  for (;;) {
    if (fs.existsSync(path.join(A, 'STOP'))) { st.status = 'stopped'; saveLine(st); say('STOP — jalur berhenti.'); return; }
    if (fs.existsSync(path.join(A, 'HOLD'))) { await sleep(30000); continue; }

    // -- sinkron status mission dari state file --
    for (const m of st.missions) {
      const ms = readJson(path.join(ROOT, m.stateFile));
      if (m.phase === 'trigger') {
        if (ms && ms.step === 'done') {
          m.phase = 'settled'; m.ok = true; m.points = ms.totalPoints; m.mission = ms.mission;
          m.triggerAddr = ms.triggerAddr; m.triggerTs = ms.triggerTs; m.settledTs = Date.now();
          saveLine(st);
          say(`MISSION #${m.n} (${m.name}) SELESAI ✅ poin ≈ ${ms.totalPoints}`);
        } else if (Date.now() - Math.max(m.triggerTs || 0, (ms && ms.triggerTs) || 0) > 5 * 60000 && !hasProc(`factory_m${m.n}_stat[e]`)) {
          say(`⚠️ #${m.n} pemicu mati di step ${ms ? ms.step : '?'} — resume...`);
          spawnDetached(['scripts/factory-mission.js', '--run', '--phase', 'trigger', '--plan', m.planFile, '--state', m.stateFile, '--log', m.logFile, '--name', m.name, '--ticker', m.ticker], m.logFile);
        }
      } else if (m.phase === 'seeding') {
        if (ms && ['aged', 'trigger', 'sell', 'verify', 'done'].includes(ms.step)) {
          if (ms.step === 'done') { m.phase = 'settled'; m.ok = true; m.points = ms.totalPoints; m.mission = ms.mission; }
          else {
            const ts = Math.max(...Object.values(ms.buys || {}).map((x) => x.ts || 0), Date.now() - 1000);
            m.phase = 'aged'; m.seededTs = ts; m.mission = ms.mission;
          }
          saveLine(st);
          say(`#${m.n} (${m.name}) FASE A ✅ → aged`);
        } else if (Date.now() - (m.createdTs || 0) > 3 * 60000 && !hasProc(`factory_m${m.n}_stat[e]`)) {
          say(`⚠️ #${m.n} seed-child mati di step ${ms ? ms.step : '?'} — resume...`);
          spawnDetached(['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', m.planFile, '--state', m.stateFile, '--log', m.logFile, '--name', m.name, '--ticker', m.ticker], m.logFile);
        }
      } else if (m.phase === 'settled' && m.triggerAddr && !m.triggerSold && Date.now() - (m.triggerTs || 0) > AGE_MS + 60000) {
        // jual token wallet pemicu (telat 61 mnt biar fuel-nya aman)
        spawnDetached(['scripts/sell-token.js', '--wallet', m.triggerAddr, '--mission', m.mission, '--run'], m.logFile);
        m.triggerSold = true; saveLine(st);
        say(`🧹 jual token wallet pemicu #${m.n} (${m.triggerAddr.slice(0, 10)})...`);
      }
    }

    // -- B: PEMICU mission paling tua yang umurnya udah 61+ mnt (TURBO: maks MAX_TRIG paralel) --
    let trigCount = st.missions.filter((m) => m.phase === 'trigger').length;
    while (trigCount < MAX_TRIG) {
      const cand = st.missions.find((m) => m.phase === 'aged' && Date.now() - m.seededTs >= AGE_MS);
      if (!cand) break;
      cand.phase = 'trigger'; cand.triggerTs = Date.now(); saveLine(st); trigCount++;
      say(`PEMICU #${cand.n} (${cand.name}) — umur ${((Date.now() - cand.seededTs) / 60000).toFixed(1)} mnt, sisa kurva disamber 🚀 (paralel ${trigCount}/${MAX_TRIG})`);
      spawnDetached(['scripts/factory-mission.js', '--run', '--phase', 'trigger', '--plan', cand.planFile, '--state', cand.stateFile, '--log', cand.logFile, '--name', cand.name, '--ticker', cand.ticker], cand.logFile);
    }

    // -- A: PRODUKSI mission berikutnya (fund → create + FASE A, seed ASYNC — antrian gak ke-blok) --
    const seeding = st.missions.some((m) => m.phase === 'seeding');
    const queue = st.missions.filter((m) => m.phase === 'aged').length;
    if (!seeding && queue < MAX_QUEUE && st.nextWindow < wins.length) {
      const wi = st.nextWindow;
      const chunk = wins[wi];
      const mN = wi + { 1: 2, 2: 36, 3: 71, 4: 107 }[LAP];
      const creator = chunk[0];
      const backers = chunk.slice(1);
      const aCount = Math.min(MAXA, Math.max(1, backers.length - 1));
      const trigger = backers[backers.length - 1];
      const phaseA = backers.slice(0, aCount);
      const skipped = backers.slice(aCount, backers.length - 1);
      const gap = Math.max(0.001, LIFT_NET - aCount * A_BUY * 0.99);
      const trigWant = gap * 1.12 / 0.99 + 0.0015;
      const [name, ticker] = LAP >= 3 ? genName(wi, LAP) : NAMESEL[wi % NAMESEL.length];
      const planFile = `analysis/line_m${mN}_plan.json`;
      const fundFile = `analysis/line_m${mN}_fund.json`;
      const stateFile = `analysis/factory_m${mN}_state.json`;
      const logFile = `logs/line_m${mN}.log`;
      const exclFile = `analysis/line_m${mN}_exclude.txt`;

      const m = { n: mN, name, ticker, wallets: chunk, planFile, fundFile, stateFile, logFile, buy: A_BUY, skipped, phase: 'seeding', createdTs: Date.now() };
      st.missions.push(m); st.nextWindow++; saveLine(st);
      say(`── PRODUKSI #${mN} (${name}/${ticker}) | ${chunk.length} wallet | faseA ${aCount}×${A_BUY} | pemicu ${trigger.slice(0, 10)} | skip ${skipped.length} ──`);

      fs.writeFileSync(path.join(ROOT, planFile), JSON.stringify([
        { role: 'creator', addr: creator },
        ...backers.map((b) => ({ role: 'backer', addr: b })),
        ...SPARES.map((s) => ({ role: 'spare', addr: s })),
      ], null, 1));
      fs.writeFileSync(path.join(ROOT, fundFile), JSON.stringify([
        { addr: creator, want: '0.0028' },
        ...phaseA.map((b) => ({ addr: b, want: fmt(A_BUY + 0.0015) })),
        { addr: trigger, want: fmt(trigWant) },
        ...SPARES.map((s) => ({ addr: s, want: '0.0055' })),
      ], null, 1));
      // exclude: wallet mission yang BELUM kelar (semua duitnya dijagain) + spares
      const excl = new Set(SPARES.map((x) => x.toLowerCase()));
      for (const mm of st.missions) if (ACTIVE_PHASES.includes(mm.phase) && mm.n !== mN) for (const w of mm.wallets) excl.add(w.toLowerCase());
      fs.writeFileSync(path.join(ROOT, exclFile), [...excl].join('\n'));

      say(`funding #${mN}...`);
      let funded = false;
      for (let tr = 1; tr <= 8 && !funded; tr++) {
        const fr = spawnSync('node', ['scripts/consolidate.js', '--plan', fundFile, '--run', '--exclude', exclFile], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
        const fOut = (fr.stdout || '') + (fr.stderr || '');
        process.stdout.write(fOut);
        const shorts = [...fOut.matchAll(/kurang ([\d.]+) ETH/g)].map((x) => Number(x[1]));
        const shortTotal = shorts.reduce((a, b) => a + b, 0);
        const gm = /SELESAI: (\d+) ok \| (\d+) gagal/.exec(fOut);
        const gFail = gm ? Number(gm[2]) : 0;
        if (shortTotal <= 0.004 && gFail === 0) funded = true;
        else { say(`funding #${mN} kurang ${shortTotal.toFixed(4)} ETH / ${gFail} tx gagal — tunggu 60s (duit dari jualan balik)... [${tr}/8]`); await sleep(60000); }
      }
      if (!funded) {
        say(`⚠️ funding #${mN} GAGAL (kas kering) — produksi DIBATALKAN, coba lagi tick depan.`);
        st.missions = st.missions.filter((x) => x.n !== mN);
        st.nextWindow--;
        saveLine(st);
        await sleep(30000);
        continue;
      }
      await sleep(2000);
      say(`create + FASE A #${mN} (ASYNC — antrian pemicu jalan terus)...`);
      spawnDetached(['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', planFile, '--state', stateFile, '--log', logFile, '--name', name, '--ticker', ticker], logFile);
      // fase 'seeding' dipromosikan ke 'aged' oleh blok sync di tick berikutnya (produksi berikutnya nunggu ini kelar)
    }

    // -- selesai semua? --
    const active = st.missions.some((m) => ACTIVE_PHASES.includes(m.phase));
    if (st.nextWindow >= wins.length && !active) {
      st.status = 'done'; saveLine(st);
      const pts = st.missions.reduce((a, m) => a + (Number(m.points) || 0), 0);
      say(`=== JALUR v3.2${LAP > 1 ? ' LAP ' + LAP : ''} SELESAI: ${st.missions.length} mission | poin ≈ ${pts} ===`);
      return;
    }
    // -- deteksi macet --
    const anyActive = st.missions.some((m) => ACTIVE_PHASES.includes(m.phase));
    const newestTs = st.missions.reduce((a, m) => Math.max(a, m.createdTs || 0, m.seededTs || 0, m.triggerTs || 0, m.settledTs || 0), 0);
    if (!anyActive && st.nextWindow < wins.length && Date.now() - Math.max(newestTs, st.startedAt || 0) > 20 * 60000) {
      say('⚠️ produksi diam 20 mnt — pause biar dicek.'); st.status = 'stuck'; saveLine(st); fs.writeFileSync(path.join(A, 'LINE_STUCK'), 'stall'); return;
    }

    await sleep(20000);
  }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
