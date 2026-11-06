#!/usr/bin/env node
/**
 * extract-creators.js
 * Ambil 14 private key CREATOR dari .env (yang isinya seluruh fleet) -> creators.env
 *
 * Cara pakai (dari root repo, di Termux):
 *   node scripts/extract-creators.js
 *
 * Output:
 *   creators.env  -> 14 key, urut m1..m14 (dipakai scripts/launch-creators.js)
 *   + verifikasi tiap key cocok dengan address creator di analysis/creators.json
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(s => s.trim())
    .filter(l => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map(k => (k.startsWith('0x') ? k : '0x' + k));
}

function main() {
  const creatorsPath = path.join(ROOT, 'analysis', 'creators.json');
  if (!fs.existsSync(creatorsPath)) { console.error('❌ analysis/creators.json tidak ada'); process.exit(1); }
  const creators = JSON.parse(fs.readFileSync(creatorsPath, 'utf8'));

  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) { console.error('❌ .env tidak ada di root repo'); process.exit(1); }
  const keys = loadBareKeys(envFile);
  console.log(`📋 Total key di .env: ${keys.length}`);

  const byAddr = new Map();
  for (const k of keys) {
    try {
      const a = new ethers.Wallet(k).address.toLowerCase();
      if (!byAddr.has(a)) byAddr.set(a, k);
    } catch (e) { /* skip invalid */ }
  }

  const out = [];
  const missing = [];
  for (const c of creators.list) {
    const k = byAddr.get(c.addr.toLowerCase());
    if (k) out.push(k);
    else missing.push(`${c.mission} ${c.addr} (${c.name})`);
  }

  if (missing.length) {
    console.error('❌ Key TIDAK ketemu untuk creator berikut (cek .env lu):');
    missing.forEach(m => console.error('   ' + m));
    process.exit(1);
  }

  const outPath = path.join(ROOT, creators.envPath || 'creators.env');
  fs.writeFileSync(outPath, out.join('\n') + '\n');
  console.log(`✅ ${out.length} key creator ditulis ke ${creators.envPath || 'creators.env'}`);
  creators.list.forEach(c => console.log(`   ${c.mission.padEnd(4)} ${c.name} (${c.ticker}) <- ${c.addr}`));
}

main();
