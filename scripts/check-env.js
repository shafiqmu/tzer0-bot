#!/usr/bin/env node
// scripts/check-env.js — install fleet .env dari cache Telegram + validasi (TIDAK pernah print private key)
const fs = require('fs');
const path = require('path');
const { Wallet } = require('ethers');

const ROOT = path.join(__dirname, '..');
const SRC = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : '/home/ubuntu/.hermes/cache/documents/doc_8ef310c2d36f_fleet-keys.txt';
const ENV = path.join(ROOT, '.env');
const t = (a) => String(a || '').slice(0, 10) + '…';

// 1) install .env (RPC diarahkan ke publicnode; sepolia.base.org balas 403 dari VPS)
if (!fs.existsSync(ENV) || process.argv.includes('--force')) {
  let raw = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  raw = raw.replace(/^RPC_URL=.*$/m, 'RPC_URL=https://base-sepolia-rpc.publicnode.com');
  fs.writeFileSync(ENV, raw, 'utf8');
  console.log(`[install] .env ditulis dari cache (${raw.length} bytes)`);
} else {
  console.log('[install] .env sudah ada — skip (pakai --force buat rewrite)');
}

// 2) parse keys
const raw = fs.readFileSync(ENV, 'utf8');
const keyLines = raw.split('\n').map((l) => l.trim()).filter((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l));
const keys = keyLines.map((k) => (k.startsWith('0x') ? k : '0x' + k).toLowerCase());
const uniq = new Set(keys);
const addrs = keys.map((k) => new Wallet(k).address.toLowerCase());
const aset = new Set(addrs);

// 3) fleet cross-check
const fleet = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'wallets_full.json'), 'utf8')).map((a) => a.toLowerCase());
const fset = new Set(fleet);
const matched = [...aset].filter((a) => fset.has(a)).length;
const missing = [...fset].filter((a) => !aset.has(a));
const extra = [...aset].filter((a) => !fset.has(a));

console.log(JSON.stringify({
  keyLines: keyLines.length,
  uniqueKeys: uniq.size,
  uniqueAddrs: aset.size,
  fleetCount: fleet.length,
  matched,
  missingFromEnv: missing.length,
  extraInEnv: extra.length,
  missingSample: missing.slice(0, 5).map(t),
  extraSample: extra.slice(0, 5).map(t),
  rpcLine: (raw.match(/^RPC_URL=.*$/m) || [''])[0],
  chainLine: (raw.match(/^CHAIN_ID=.*$/m) || [''])[0],
}, null, 2));

// 4) plan sanity (angka saja — bukan rahasia)
const creators = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'creators.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'topup_plan_v2.json'), 'utf8'));
const alloc = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis', 'allocator_14m.json'), 'utf8'));

console.log('creators top-level keys:', Object.keys(creators).join(','));
const clist = creators.list || [];
console.log('creators list len:', clist.length, '| elem fields:', clist[0] ? Object.keys(clist[0]).join(',') : '-');
const c0 = clist[0] || {};
console.log('creator[0]:', JSON.stringify({ mission: c0.mission, name: c0.name, ticker: c0.ticker, addr: t((c0.addr || '').toLowerCase()) }));

let table = null, tableKey = '';
for (const [k, v] of Object.entries(plan)) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const vals = Object.values(v);
    if (vals.length > 100 && typeof vals[0] === 'number') { table = v; tableKey = k; }
  }
}
const tvals = Object.values(table || {});
console.log('plan top-level keys:', Object.keys(plan).join(','), '| tableKey:', tableKey);
console.log('plan targets count:', tvals.length, '| sum:', tvals.reduce((s, v) => s + Number(v || 0), 0).toFixed(6));
const dist = {};
for (const v of tvals) { const k = Number(v).toFixed(5); dist[k] = (dist[k] || 0) + 1; }
console.log('topup distribution:', JSON.stringify(dist));
console.log('plan covers fleet:', fleet.filter((a) => table && table[a] !== undefined).length + '/1000');

const five = (alloc.five_ticket_wallets || []).map((x) => String(typeof x === 'string' ? x : (x.addr || x.address || '')).toLowerCase());
console.log('five_ticket_wallets:', five.map(t).join(', '));
for (const a of five) console.log('  topup[five]', t(a), '=', table ? table[a] : '?');
let nCreatorInFleet = 0;
for (const c of clist) {
  const ca = String(c.addr || '').toLowerCase();
  if (fset.has(ca)) nCreatorInFleet++;
  console.log('  topup[creator]', t(ca), '=', table ? table[ca] : '?', '|', c.mission, c.ticker);
}
console.log('creators in fleet:', `${nCreatorInFleet}/${clist.length}`);
