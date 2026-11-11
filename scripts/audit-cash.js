// audit-cash.js — LAPORAN NET ON-CHAIN (aturan user 11/11: NET ONLY, no gross)
// Assets (fleet 1000 + relays) - Injections (ledger) = NET
// Usage: node scripts/audit-cash.js
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const RPCS = [
  process.env.TZERO_RPC,
  'https://base-sepolia-rpc.publicnode.com',
  'https://sepolia.base.org',
  'https://base-sepolia.drpc.org',
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadFleet() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/wallets_full.json'), 'utf8'));
  return raw.map(x => (typeof x === 'string' ? x : x.address)).filter(a => /^0x[a-fA-F0-9]{40}$/.test(a));
}
function loadRelays() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'analysis/relays.json'), 'utf8'));
    return (j.relays || j).map(x => (typeof x === 'string' ? x : x.address));
  } catch { return []; }
}
function loadLedger() {
  const p = path.join(ROOT, 'analysis/audit_ledger.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

let rpcIdx = 0;
function nextRpc() { rpcIdx = (rpcIdx + 1) % RPCS.length; return RPCS[rpcIdx]; }

async function rpcBatch(slice, rpc) {
  const body = slice.map((a, k) => ({ jsonrpc: '2.0', id: k + 1, method: 'eth_getBalance', params: [a, 'latest'] }));
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  if (!arr.length || (arr.length === 1 && arr[0].error)) throw new Error('batch rejected: ' + JSON.stringify(arr[0]).slice(0, 120));
  const out = {};
  for (const item of arr) {
    const idx = (item?.id || 0) - 1;
    if (item?.result !== undefined && slice[idx] !== undefined) {
      out[slice[idx].toLowerCase()] = Number(BigInt(item.result)) / 1e18;
    }
  }
  if (Object.keys(out).length < slice.length) throw new Error(`partial ${Object.keys(out).length}/${slice.length}`);
  return out;
}

async function scan(addrList) {
  const acc = {};
  const failed = [];
  async function go(list) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { Object.assign(acc, await rpcBatch(list, RPCS[attempt % RPCS.length])); return; }
      catch (e) { await sleep(300); }
    }
    if (list.length === 1) { failed.push(list[0]); return; }
    const mid = Math.ceil(list.length / 2);
    await go(list.slice(0, mid)); await sleep(250);
    await go(list.slice(mid));
  }
  for (let i = 0; i < addrList.length; i += 25) {
    await go(addrList.slice(i, i + 25));
    await sleep(300);
    process.stdout.write(`\r  scan ${Math.min(i + 25, addrList.length)}/${addrList.length}...`);
  }
  console.log('');
  return { acc, failed };
}

(async () => {
  const fleet = loadFleet();
  const relays = loadRelays();
  const ledger = loadLedger();
  console.log(`Fleet: ${fleet.length} wallet | Relay: ${relays.length}\n`);

  const f = await scan(fleet);
  const r = await scan(relays);

  const fleetSum = Object.values(f.acc).reduce((a, b) => a + b, 0);
  const relaySum = Object.values(r.acc).reduce((a, b) => a + b, 0);
  const assets = fleetSum + relaySum;

  const inj = ledger ? ledger.injections.reduce((a, x) => a + x.eth, 0) : null;
  const missions = fs.readdirSync(path.join(ROOT, 'analysis')).filter(f2 => /^factory_m\d+_state\.json$/.test(f2)).length;

  console.log('='.repeat(46));
  console.log(`FLEET (${Object.keys(f.acc).length}/${fleet.length} kebaca) : ${fleetSum.toFixed(3)} ETH`);
  console.log(`RELAY (${Object.keys(r.acc).length}/${relays.length})          : ${relaySum.toFixed(3)} ETH`);
  const totalFail = f.failed.length + r.failed.length;
  console.log(`ASET KAS            : ${assets.toFixed(3)} ETH${totalFail ? `   ⚠️ ${totalFail} wallet GAGAL kebaca (angka kurang!)` : '   ✅ semua kebaca'}`);
  if (inj !== null) {
    console.log(`MODAL MASUK (ledger): ${inj.toFixed(3)} ETH`);
    console.log(`NET ON-CHAIN        : ${(assets - inj).toFixed(3)} ETH  ← INI YANG DILAPOR`);
  } else {
    console.log('(ledger belum ada)');
  }
  console.log(`Misi tercatat       : ${missions}`);
  console.log('='.repeat(46));

  const dir = path.join(ROOT, 'analysis/audit_snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `audit_${ts}.json`), JSON.stringify({
    ts: new Date().toISOString(), fleetSum, relaySum, assets, injections: inj,
    net: inj !== null ? assets - inj : null, missions, failed: totalFail
  }, null, 2));
  console.log(`snapshot → analysis/audit_snapshots/audit_${ts}.json`);
})();
