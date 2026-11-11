// market-heatmap2.js — v2: klasifikasi LENGKAP (curve buys incl!) + per-event
// Jawab: ada GAK pembeli luar (via launchpad ATAU via pair) di era baru? Siapa? Jam berapa?
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');

const LAUNCHPAD = '0xbce48917c41bb45ad15f859e4bf0e4eea74bad5c';
const ROUTER = '0x21bbd201c69d0091707d0367d3ad6875cec150e1';
const FACTORY = '0xf9ce1f9d20d5d42515b27fe2a5380b89a0be927e';
const SPLITTER = '0x1c69a90c69fdb2f2e459fca23ca6b22acd707b3b';
const WETH = '0x4200000000000000000000000000000000000006';
const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';
const CONST_SET = new Set([LAUNCHPAD, ROUTER, FACTORY, SPLITTER, WETH, ZERO, DEAD]);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (p) => new Promise(res => {
  https.get({ hostname: 'base-sepolia.blockscout.com', path: p, headers: { 'user-agent': 'Mozilla/5.0' }, timeout: 25000 }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { res(null) } });
  }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null) });
});

const tokens = {};
for (const f of fs.readdirSync(A).filter(f => /^factory_m\d+_state\.json$/.test(f))) {
  try { const j = JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));
    if (j.mission && /^0x[a-fA-F0-9]{40}$/.test(j.mission)) tokens[parseInt(f.match(/m(\d+)/)[1])] = { n: parseInt(f.match(/m(\d+)/)[1]), token: j.mission.toLowerCase(), name: j.name };
  } catch (e) { }
}
for (const lf of ['line_state8.json', 'line_state7.json', 'line_state6.json', 'line_state5.json']) {
  try { const j = JSON.parse(fs.readFileSync(path.join(A, lf), 'utf8'));
    for (const m of (j.missions || [])) if (m.n && m.mission && !tokens[m.n]) tokens[m.n] = { n: m.n, token: m.mission.toLowerCase(), name: m.name };
  } catch (e) { }
}
const list = Object.values(tokens).sort((a, b) => a.n - b.n);
console.log('token:', list.length);

const cluster = new Set(JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map(x => (typeof x === 'string' ? x : x.address).toLowerCase()));
try { const r = JSON.parse(fs.readFileSync(path.join(A, 'relays.json'), 'utf8')); for (const x of (r.relays || r)) cluster.add((typeof x === 'string' ? x : x.address).toLowerCase()); } catch (e) { }
// temen user + funder masuk "bukan cluster" — biar keliatan keduanya
const FRIEND = process.env.FRIEND_ADDR || '0x0000000000000000000000000000000000000000'; // wallet luar (dulu hardcoded) — isi via env FRIEND_ADDR

const isExt = a => { a = (a || '').toLowerCase(); return !cluster.has(a) && !CONST_SET.has(a) && !a.startsWith('0x227a7108'); };

(async () => {
  const out = [];
  let i = 0;
  for (const t of list) {
    let page = null, trs = [];
    for (let k = 0; k < 3; k++) {
      const q = page ? `/api/v2/tokens/${t.token}/transfers?${new URLSearchParams(page)}` : `/api/v2/tokens/${t.token}/transfers`;
      const j = await get(q);
      if (!j || !j.items?.length) break;
      trs.push(...j.items);
      if (!j.next_page_params) break;
      page = j.next_page_params;
    }
    // pair detect: penerima transfer TERBANYAK dari cluster
    const recv = {};
    for (const x of trs) { const f = (x.from?.hash || '').toLowerCase(), to = (x.to?.hash || '').toLowerCase();
      if (cluster.has(f) && !cluster.has(to) && !CONST_SET.has(to) && !to.startsWith('0x227a7108')) recv[to] = (recv[to] || 0) + 1; }
    const pair = Object.entries(recv).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const ev = { curveBuys: [], pairBuys: [], extSells: [], burns: 0, burnFromOur: 0 };
    for (const x of trs) {
      const f = (x.from?.hash || '').toLowerCase(), to = (x.to?.hash || '').toLowerCase();
      const ts = x.timestamp || '';
      const amt = Number(x.total?.value || 0) / 1e18;
      if (to === DEAD || to === ZERO) { ev.burns++; if (cluster.has(f)) ev.burnFromOur++; continue; }
      if (f === LAUNCHPAD && isExt(to)) ev.curveBuys.push({ ts, amt, addr: to });
      else if (pair && f === pair && isExt(to)) ev.pairBuys.push({ ts, amt, addr: to });
      else if (isExt(f) && (to === pair || to === LAUNCHPAD)) ev.extSells.push({ ts, amt, addr: f });
    }
    out.push({ n: t.n, name: t.name, pair, trs: trs.length, curveBuys: ev.curveBuys, pairBuys: ev.pairBuys, extSells: ev.extSells, burns: ev.burns, burnFromOur: ev.burnFromOur });
    i++;
    if (i % 10 === 0 || i === list.length) process.stdout.write(`\r  ${i}/${list.length}...`);
    await sleep(250);
  }
  console.log('');

  const realBuys = r => [...r.curveBuys, ...r.pairBuys].filter(b => b.addr !== FRIEND);
  const anyBuys = r => r.curveBuys.length + r.pairBuys.length;
  const eras = { early: out.filter(r => r.n < 100), new: out.filter(r => r.n >= 100) };

  console.log('\n===== HASIL v2 =====');
  for (const [nm, arr] of Object.entries(eras)) {
    const wb = arr.filter(r => anyBuys(r) > 0);
    const wbReal = arr.filter(r => realBuys(r).length > 0);
    const wbFriend = arr.filter(r => r.curveBuys.concat(r.pairBuys).some(b => b.addr === FRIEND));
    console.log(`\n[${nm}] misi ${arr.length} | ada buyluar: ${wb.length} | non-temen: ${wbReal.length} | dari temen: ${wbFriend.length}`);
    const totCurve = arr.reduce((a, r) => a + r.curveBuys.length, 0), totPair = arr.reduce((a, r) => a + r.pairBuys.length, 0);
    console.log(`   curve-buys luar: ${totCurve} event | pair-buys luar: ${totPair} event`);
    console.log(`   total burn: ${arr.reduce((a, r) => a + r.burns, 0)} (dari kita: ${arr.reduce((a, r) => a + r.burnFromOur, 0)})`);
  }
  // era baru detail (m>=140) siapa2nya
  console.log('\n--- ERA BARU (m>=140) yg ada aktivitas luar ---');
  for (const r of out.filter(r => r.n >= 140 && anyBuys(r) > 0)) {
    console.log(`  m${r.n} ${r.name}: curve:${r.curveBuys.length} pair:${r.pairBuys.length} | addrs: ${[...new Set([...r.curveBuys, ...r.pairBuys].map(b => b.addr.slice(0, 10)))].join(',')}`);
  }
  // temen muncul di mana
  console.log('\n--- 0x7A6 (temen) muncul di misi: ---');
  for (const r of out.filter(r => r.curveBuys.concat(r.pairBuys).some(b => b.addr === FRIEND))) {
    console.log(`  m${r.n} ${r.name}: ${r.curveBuys.filter(b => b.addr === FRIEND).length} curve + ${r.pairBuys.filter(b => b.addr === FRIEND).length} pair`);
  }
  // histogram non-temen per jam
  const hist = {};
  for (const r of out) for (const b of [...r.curveBuys, ...r.pairBuys]) { if (b.addr === FRIEND) continue; const h = ((new Date(b.ts).getUTCHours() + 8) % 24).toString().padStart(2, '0'); hist[h] = (hist[h] || 0) + 1; }
  console.log('\nHistogram (non-temen) per jam server:');
  for (let h = 0; h < 24; h++) { const k = h.toString().padStart(2, '0'); console.log(`  ${k}:00 ${'█'.repeat(Math.min(30, hist[k] || 0))} ${hist[k] || 0}`); }
  // top addrs non-temen
  const tally = {};
  for (const r of out) for (const b of [...r.curveBuys, ...r.pairBuys]) { if (b.addr === FRIEND) continue; tally[b.addr] = (tally[b.addr] || 0) + 1; }
  console.log('\nTop alamat luar non-temen:');
  for (const [a, c] of Object.entries(tally).sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`  ${a} → ${c}`);
  fs.writeFileSync(path.join(A, 'market_heatmap2.json'), JSON.stringify({ generatedAt: new Date().toISOString(), out }, null, 1));
  console.log('\nsaved → analysis/market_heatmap2.json');
})();
