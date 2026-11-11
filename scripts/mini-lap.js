// mini-lap.js v2 — fast-track wallet chronic <500 (misinya penuh window 27)
// v2: funding RETRY-LOOP (sampai saldo kekar, baru lanjut), resume-safe, auto-verify beli.
// Usage: node scripts/mini-lap.js --run [--cycles 9] [--goal 510]
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const https = require('https');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');

const RUN = process.argv.includes('--run');
const CAP = Number((() => { const i = process.argv.indexOf('--cycles'); return i >= 0 ? process.argv[i + 1] : 9; })());
const GOAL = Number((() => { const i = process.argv.indexOf('--goal'); return i >= 0 ? process.argv[i + 1] : 510; })());
const A_BUY = 0.0114, MAXA = 27, LIFT_NET = 0.28335;
const WINDOW = 27;            // creator + 26 backers (25 faseA + 1 trigger)
const HOLD_WAIT_MS = 62 * 60000;

const TARGETS = [
  '0x0769665caec5b460d423f82cad43db56a50b5ad8',
  '0x0f665c7b850b048c80b391d7c5aec135a70e5adb',
  '0xdcce97134c93c03703145f90c62404834b1ce5bf',
  '0x55f2fa93ae2b6cd803759ec05f5bf1edf473e2ed',
  '0xd17d77f072497679b1a6a84ca8252e44789796de',
  '0x0b6fc40a56aa253e117475a92a0dd5a79dce9852',
  '0x2dffe287cf363ad8d26802c6392fe4e12caa0e6f',
  '0xb1d4a601398dbccd87a8563d30e81cedb988814f',
  '0xc96b79326ff207649dbe0dca57890d55bff04fa9',
];
const NAMES = ['Cinder Vault', 'Willow Bazaar', 'Halcyon Pier', 'Onyx Plateau', 'Velvet Harbor', 'Quartz Canyon', 'Umber Outpost', 'Lumen Grove', 'Sable Crossing', 'Ivory Station'];
const norm = (a) => a.toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...xs) => { const l = `[${new Date().toISOString()}] ${xs.join(' ')}`; console.log(l); try { fs.appendFileSync(path.join(ROOT, 'logs/mini-lap.log'), l + '\n'); } catch (e) {} };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return null; } };
const writeJson = (p, j) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(j, null, 1));
const fmt = (x) => String(Number(x.toFixed(6)));

const RPC_LIST = ['base-sepolia-rpc.publicnode.com', 'sepolia.base.org', 'base-sepolia.drpc.org'];
async function getBalance(addr) {
  for (const host of RPC_LIST) {
    const v = await new Promise((res) => {
      const d = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [addr, 'latest'] });
      const r = https.request({ hostname: host, path: '/', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(d) }, timeout: 12000 }, (rr) => {
        let s = ''; rr.on('data', (c) => s += c); rr.on('end', () => { try { const j = JSON.parse(s); res(j.result ? parseInt(j.result, 16) / 1e18 : null); } catch (e) { res(null); } });
      });
      r.on('error', () => res(null)); r.on('timeout', function () { this.destroy(); res(null); }); r.write(d); r.end();
    });
    if (v !== null) return v;
  }
  return null;
}
function pointsOf(addr) {
  return new Promise((res) => {
    https.get({ hostname: 'testnet.tzer0.fun', path: '/api/points/' + addr, timeout: 20000, headers: { 'user-agent': 'Mozilla/5.0' } }, (r) => {
      let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { const j = JSON.parse(d); res(typeof j.total === 'number' ? j.total : null); } catch (e) { res(null); } });
    }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null); });
  });
}

(async () => {
  const stFile = 'analysis/mini_lap_state.json';
  const st = readJson(stFile) || { cycle: 0, history: [], startedAt: new Date().toISOString() };

  const scan = readJson('analysis/points_scan_1794362672677.json');
  const results = (scan && scan.results) || {};
  const spares = (readJson('analysis/factory_plan.json') || []).filter((p) => p.role === 'spare').map((p) => norm(p.addr));
  const pool = Object.entries(results)
    .filter(([a, r]) => { const n = norm(a); return (r.total || 0) >= 1500 && (r.total || 0) < 2050 && !TARGETS.includes(n) && !spares.includes(n); })
    .map(([a]) => a);
  say(`MINI-LAP v2 start | target ${TARGETS.length} | pool ${pool.length} | CAP ${CAP} | goal ≥${GOAL}`);
  if (!RUN) { say('DRY — pakai --run'); return; }

  for (let c = st.cycle + 1; c <= CAP; c++) {
    if (fs.existsSync(path.join(A, 'STOP'))) { say('STOP — keluar.'); break; }
    while (fs.existsSync(path.join(A, 'HOLD'))) { say('HOLD — nunggu...'); await sleep(60000); }

    const pts = {};
    for (const t of TARGETS) pts[t] = await pointsOf(t);
    const left = TARGETS.filter((t) => !(pts[t] !== null && pts[t] >= GOAL));
    say(`── SIKLUS ${c} | poin: ${TARGETS.map((t) => (pts[t] === null ? '?' : Math.round(pts[t]))).join('/')} | sisa: ${left.length}`);
    if (!left.length) { say(`🎉 SEMUA ≥${GOAL} — selesai.`); st.cycle = c - 1; writeJson(stFile, st); break; }

    // window
    const cIdx = (c - 1) % pool.length;
    const creator = pool[cIdx];
    const fillers = [];
    for (let k = 0; k < pool.length && fillers.length < WINDOW - 1 - TARGETS.length; k++) {
      const a = pool[(cIdx + 1 + k * 3) % pool.length];
      if (a !== creator && !TARGETS.includes(norm(a)) && !fillers.includes(a)) fillers.push(a);
    }
    const mix = [...TARGETS, ...fillers];
    const backersRaw = [];
    for (let k = 0; k < mix.length; k++) backersRaw.push(mix[(k * 7 + 3) % mix.length]);
    const backers = [...new Set(backersRaw)];
    const trigger = backers[backers.length - 1];
    const aCount = Math.min(MAXA, Math.max(1, backers.length - 1));
    const gap = Math.max(0.001, LIFT_NET - aCount * A_BUY * 0.99);
    const trigWant = gap * 1.12 / 0.99 + 0.0015;
    const nm = NAMES[(c - 1) % NAMES.length] + ' ' + (100 + Math.floor(Math.random() * 900));
    const tick = nm.split(' ').map((w) => w.slice(0, 2)).join('').toUpperCase().slice(0, 4);
    const planF = `analysis/mini_c${c}_plan.json`, fundF = `analysis/mini_c${c}_fund.json`;
    const stateF = `analysis/mini_c${c}_state.json`, logF = `logs/mini_c${c}.log`, exclF = `analysis/mini_c${c}_exclude.txt`;

    // wants per wallet
    const wants = { [norm(creator)]: 0.0028 };
    backers.slice(0, aCount).forEach((b) => { wants[norm(b)] = A_BUY + 0.0015; });
    wants[norm(trigger)] = trigWant;

    // excl: lap actives (spare TIDAK di-exclude — disikat buat modal)
    const excl = new Set();
    const ls8 = readJson('analysis/line_state8.json');
    for (const m of (ls8 && ls8.missions) || []) if (['aged', 'trigger', 'sell', 'wait1', 'wait2', 'burst'].includes(m.phase)) for (const w of (m.wallets || [])) excl.add(norm(w));
    fs.writeFileSync(path.join(A, `mini_c${c}_exclude.txt`), [...excl].join('\n'));

    // resume check
    let s0 = readJson(stateF);
    const resume = s0 && s0.step === 'aged' && Object.keys(s0.buys || {}).length > 0;
    say(`siklus ${c}: "${nm}" | creator ${creator.slice(0, 10)} | backer ${backers.length} | trigger ${trigger.slice(0, 10)} | ${resume ? 'RESUME misi lama' : 'misi baru'}`);

    if (!resume) {
      fs.rmSync(path.join(ROOT, stateF), { force: true });
      writeJson(planF, [
        { role: 'creator', addr: creator },
        ...backers.map((b) => ({ role: 'backer', addr: b })),
        ...spares.map((s) => ({ role: 'spare', addr: s })),
      ]);
      writeJson(fundF, [
        { addr: creator, want: '0.0028' },
        ...backers.slice(0, aCount).map((b) => ({ addr: b, want: fmt(A_BUY + 0.0015) })),
        { addr: trigger, want: fmt(trigWant) },
      ]);

      // FUND LOOP — sampai semua wallet kekar
      say(`siklus ${c}: funding...`);
      let funded = false;
      for (let k = 1; k <= 40; k++) {
        spawnSync('node', ['scripts/consolidate.js', '--plan', fundF, '--run', '--exclude', exclF], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
        const check = [creator, ...backers];
        let ok = 0;
        const rep = [];
        for (const w of check) {
          const b = await getBalance(w);
          const need = wants[norm(w)] * 0.92;
          if (b !== null && b >= need) ok++;
          rep.push(b === null ? '?' : b.toFixed(4));
        }
        say(`  attempt ${k}: ${ok}/${check.length} kekar`);
        if (ok >= check.length) { funded = true; break; }
        await sleep(150000);
      }
      if (!funded) { say(`siklus ${c}: FUNDING GAGAL — skip siklus.`); st.history.push({ c, ok: false, note: 'fund' }); st.cycle = c; writeJson(stFile, st); continue; }
      say(`siklus ${c}: funding OK ✅`);

      const seed = spawnSync('node', ['scripts/factory-mission.js', '--run', '--phase', 'seed', '--plan', planF, '--state', stateF, '--log', logF, '--name', nm, '--ticker', tick], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
      say(`siklus ${c}: seed exit ${seed.status}`);
    } else {
      say(`siklus ${c}: RESUME — skip fund+seed, top-up trigger saja`);
    }

    let s = readJson(stateF);
    for (let k = 0; k < 60 && s && s.step !== 'aged'; k++) { await sleep(15000); s = readJson(stateF); }
    if (!s || s.step !== 'aged') { say(`siklus ${c}: seed gak nyampe aged (step ${s && s.step}) — lanjut siklus berikut.`); st.history.push({ c, ok: false, note: 'seed' }); st.cycle = c; writeJson(stFile, st); continue; }
    const buyTs = Math.max(...Object.values(s.buys || {}).map((b) => b.ts || 0), Date.now());
    const bought = TARGETS.filter((t) => Object.keys(s.buys || {}).some((k2) => norm(k2) === norm(t)));
    say(`siklus ${c}: aged ✅ | beli ${Object.keys(s.buys || {}).length} wallet | target ${bought.length}/${TARGETS.length}`);

    // tunggu hold
    const waitMs = buyTs + HOLD_WAIT_MS - Date.now();
    if (waitMs > 0) { say(`siklus ${c}: hold ${(waitMs / 60000).toFixed(1)} mnt...`); await sleep(waitMs); }

    // pastikan trigger punya duit (idempoten)
    for (let k = 1; k <= 10; k++) {
      const tb = await getBalance(trigger);
      if (tb !== null && tb >= trigWant * 0.85) { say(`siklus ${c}: trigger saldo ok (${tb.toFixed(4)})`); break; }
      say(`siklus ${c}: trigger kurang (${tb}) — top-up attempt ${k}`);
      spawnSync('node', ['scripts/consolidate.js', '--plan', fundF, '--run', '--exclude', exclF], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
      await sleep(60000);
    }
    const trig = spawnSync('node', ['scripts/factory-mission.js', '--run', '--phase', 'trigger', '--plan', planF, '--state', stateF, '--log', logF, '--name', nm, '--ticker', tick], { cwd: ROOT, encoding: 'utf8', timeout: 1200000 });
    s = readJson(stateF);
    say(`siklus ${c}: trigger exit ${trig.status} | step ${s && s.step} | totalPoints ${s && s.totalPoints}`);
    st.history.push({ c, ok: true, name: nm, bought: bought.length, step: s && s.step });
    st.cycle = c; writeJson(stFile, st);
    await sleep(90000);
  }
  say('MINI-LAP v2 selesai. ' + JSON.stringify(st.history));
})();
