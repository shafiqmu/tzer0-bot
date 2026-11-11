// market-heatmap.js — riset: KAPAN & SEBERAPA BANYAK pembeli LUAR beli token misi kita
// Scan semua token misi (dari state files) → klasifikasi transfer → histogram per jam + per misi
// Output: analysis/market_heatmap.json (+ ringkasan stdout)
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const ROOT = '/home/ubuntu/tzer0-bot';
const A = path.join(ROOT, 'analysis');

const CONSTANTS = [
  '0xbce48917c41bb45ad15f859e4bf0e4eea74bad5c', // launchpad
  '0x21bbd201c69d0091707d0367d3ad6875cec150e1', // router
  '0xf9ce1f9d20d5d42515b27fe2a5380b89a0be927e', // factory
  '0x1c69a90c69fdb2f2e459fca23ca6b22acd707b3b', // fee splitter
  '0x4200000000000000000000000000000000000006', // WETH
  '0x0000000000000000000000000000000000000000', // burn
  '0x227a7108', // prefix protokol (partial — dicek via startsWith)
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = (p) => new Promise(res => {
  https.get({ hostname: 'base-sepolia.blockscout.com', path: p, headers: { 'user-agent': 'Mozilla/5.0' }, timeout: 25000 }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { res(null) } });
  }).on('error', () => res(null)).on('timeout', function () { this.destroy(); res(null) });
});
const isCluster = (a, set) => set.has((a || '').toLowerCase());
const isConst = (a) => { a = (a || '').toLowerCase(); return CONSTANTS.some(c => a.startsWith(c)); };

// ==== kumpulkan token list ====
const tokens = {};
for (const f of fs.readdirSync(A).filter(f => /^factory_m\d+_state\.json$/.test(f))) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));
    if (j.mission && /^0x[a-fA-F0-9]{40}$/.test(j.mission)) {
      const n = parseInt(f.match(/m(\d+)/)[1]);
      tokens[n] = { n, token: j.mission.toLowerCase(), name: j.name, tsCreate: j.tsCreate, tsDone: j.tsDone };
    }
  } catch (e) { }
}
// lengkapi dari line_state (untuk yang state-nya kehapus)
for (const lf of ['line_state8.json', 'line_state7.json', 'line_state6.json', 'line_state5.json']) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(A, lf), 'utf8'));
    for (const m of (j.missions || [])) {
      if (m.n && m.mission && !tokens[m.n]) tokens[m.n] = { n: m.n, token: m.mission.toLowerCase(), name: m.name, tsCreate: m.createdTs, tsDone: m.settledTs };
    }
  } catch (e) { }
}
const list = Object.values(tokens).sort((a, b) => a.n - b.n);
console.log('token terkumpul:', list.length);

const cluster = new Set(JSON.parse(fs.readFileSync(path.join(A, 'wallets_full.json'), 'utf8')).map(x => (typeof x === 'string' ? x : x.address).toLowerCase()));
try { const r = JSON.parse(fs.readFileSync(path.join(A, 'relays.json'), 'utf8')); for (const x of (r.relays || r)) cluster.add((typeof x === 'string' ? x : x.address).toLowerCase()); } catch (e) { }

(async () => {
  const results = [];
  let done = 0;
  for (const t of list) {
    let page = null, transfers = [];
    for (let i = 0; i < 3; i++) {
      const q = page ? `/api/v2/tokens/${t.token}/transfers?${new URLSearchParams(page)}` : `/api/v2/tokens/${t.token}/transfers`;
      const j = await get(q);
      if (!j || !j.items || !j.items.length) break;
      transfers.push(...j.items);
      if (!j.next_page_params) break;
      page = j.next_page_params;
    }
    // deteksi pair: paling banyak terima dari cluster
    const recvFromCluster = {};
    for (const tr of transfers) {
      const f = (tr.from?.hash || '').toLowerCase(), to = (tr.to?.hash || '').toLowerCase();
      if (isCluster(f, cluster) && !isCluster(to, cluster) && !isConst(to)) recvFromCluster[to] = (recvFromCluster[to] || 0) + 1;
    }
    const pair = Object.entries(recvFromCluster).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    let extBuys = [], extSells = [], extOther = [];
    for (const tr of transfers) {
      const f = (tr.from?.hash || '').toLowerCase(), to = (tr.to?.hash || '').toLowerCase();
      const ts = tr.timestamp || '';
      const amt = Number(tr.total?.value || 0) / 1e18;
      const fc = isCluster(f, cluster) || isConst(f), tc = isCluster(to, cluster) || isConst(to);
      if (pair && f === pair && !tc) extBuys.push({ ts, amt, addr: to });
      else if (pair && to === pair && !fc) extSells.push({ ts, amt, addr: f });
      else if (!fc && !tc) extOther.push({ ts, addr: f + '>' + to });
    }
    results.push({ n: t.n, name: t.name, token: t.token, pair, transfers: transfers.length, extBuys: extBuys.length, extBuyAmt: extBuys.reduce((a, x) => a + x.amt, 0), extSells: extSells.length, extOther: extOther.length, buyTs: extBuys.map(x => x.ts), buyAddrs: [...new Set(extBuys.map(x => x.addr))] });
    done++;
    if (done % 10 === 0 || done === list.length) process.stdout.write(`\r  ${done}/${list.length} token...`);
    await sleep(250);
  }
  console.log('');

  // histogram per jam (server +8)
  const hist = {};
  const perAddr = {};
  for (const r of results) {
    for (const iso of r.buyTs) {
      const d = new Date(iso);
      const h = ((d.getUTCHours() + 8) % 24).toString().padStart(2, '0');
      hist[h] = (hist[h] || 0) + 1;
    }
    for (const a of r.buyAddrs) perAddr[a] = (perAddr[a] || 0) + 1;
  }

  const withBuys = results.filter(r => r.extBuys > 0);
  console.log('\n=== HASIL ===');
  console.log(`Misi discan: ${results.length} | ada pembeli LUAR: ${withBuys.length} (${(100 * withBuys.length / results.length).toFixed(1)}%)`);
  console.log(`Total event beli luar: ${results.reduce((a, r) => a + r.extBuys, 0)}`);
  console.log(`Total jual balik oleh luar: ${results.reduce((a, r) => a + r.extSells, 0)}`);
  console.log('\nMisi dgn pembeli luar TERBANYAK:');
  for (const r of withBuys.sort((a, b) => b.extBuys - a.extBuys).slice(0, 15)) {
    console.log(`  m${r.n} ${r.name}: ${r.extBuys} beli (${r.extBuyAmt.toFixed(0)} token) dari ${r.buyAddrs.length} alamat`);
  }
  console.log('\nHistogram jam beli luar (jam server +8):');
  for (let h = 0; h < 24; h++) {
    const k = h.toString().padStart(2, '0');
    console.log(`  ${k}:00 ${'█'.repeat(Math.min(40, hist[k] || 0))} ${hist[k] || 0}`);
  }
  console.log('\nAlamat luar paling aktif:');
  for (const [a, c] of Object.entries(perAddr).sort((x, y) => y[1] - x[1]).slice(0, 12)) console.log(`  ${a} → muncul di ${c} misi misi`);

  fs.writeFileSync(path.join(A, 'market_heatmap.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, hist, perAddr }, null, 1));
  console.log('\nsaved → analysis/market_heatmap.json');
})();
