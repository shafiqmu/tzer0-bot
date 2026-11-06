#!/usr/bin/env node
/**
 * topup.js — kirim ETH dari FUNDER ke 1000 wallet sesuai analysis/topup_plan_v2.json
 *
 * Cara pakai (root repo, Termux):
 *   FUNDER_KEY=0x... node scripts/topup.js --dry      # cek rencana (tanpa kirim)
 *   FUNDER_KEY=0x... node scripts/topup.js --run      # kirim beneran (jeda acak 2-6 dtk, ±1 jam)
 *   --limit N        -> kirim maks N aja (tes). Contoh: --limit 5
 *   --min-delay/--max-delay (dtk)
 * Kalau gak mau env var: taruh key funder di file `funder.key` (satu baris 0x...).
 * Resumable: yang sudah terkirim dicatat di analysis/topup_state.json (aman diulang).
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const ROOT = path.join(__dirname, '..');
const ANALYSIS = path.join(ROOT, 'analysis');
const PLAN = path.join(ANALYSIS, 'topup_plan_v2.json');
const STATE = path.join(ANALYSIS, 'topup_state.json');

function getFunderKey() {
  if (process.env.FUNDER_KEY) return process.env.FUNDER_KEY.trim();
  const f = path.join(ROOT, 'funder.key');
  if (fs.existsSync(f)) {
    const line = fs.readFileSync(f, 'utf8').split(/\r?\n/).map((s) => s.trim())
      .find((l) => /^(0x)?[0-9a-fA-F]{64}$/.test(l));
    if (line) return line.startsWith('0x') ? line : '0x' + line;
  }
  console.error('❌ Set FUNDER_KEY env atau bikin file funder.key (satu baris private key funder).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
function argNum(argv, name, def) { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : def; }

async function main() {
  const argv = process.argv.slice(2);
  const run = argv.includes('--run');
  const dry = !run;
  const limit = argNum(argv, '--limit', Infinity);
  const minD = argNum(argv, '--min-delay', 2);
  const maxD = argNum(argv, '--max-delay', 6);

  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const entries = Object.entries(plan.topup || {}).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  const wallet = new ethers.Wallet(getFunderKey(), provider);
  const bal = await provider.getBalance(wallet.address);

  console.log(`👛 Funder: ${wallet.address} | saldo: ${ethers.formatEther(bal)} ETH`);
  console.log(`📋 Rencana: ${entries.length} wallet | total ${total.toFixed(6)} ETH | mode: ${dry ? 'DRY (tanpa kirim)' : 'LIVE'}`);
  if (bal < ethers.parseEther((total + 0.02).toFixed(6))) {
    console.error('❌ Saldo funder kurang (butuh total + margin gas ~0.02 ETH)');
    process.exit(1);
  }

  const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { sent: {} };
  const already = Object.keys(state.sent).length;
  if (already) console.log(`ℹ️  Sudah terkirim sebelumnya: ${already} wallet (di-skip)`);

  let sentCount = 0;
  for (const [addr, amount] of entries) {
    if (state.sent[addr]) continue;
    if (sentCount >= limit) { console.log(`⏹️  limit ${limit} tercapai`); break; }
    if (dry) {
      if (sentCount < 5) console.log(`   [contoh] ${addr} ← ${amount} ETH`);
      sentCount++;
      continue;
    }
    try {
      const tx = await wallet.sendTransaction({ to: addr, value: ethers.parseEther(amount.toFixed(6)) });
      await tx.wait();
      state.sent[addr] = { txHash: tx.hash, amount, ts: Date.now() };
      sentCount++;
      if (sentCount % 25 === 0) {
        fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
        console.log(`   progress: ${sentCount} sesi ini | total ${Object.keys(state.sent).length}/${entries.length}`);
      }
      await sleep(rand(minD, maxD) * 1000);
    } catch (err) {
      console.error(`   ❌ ${addr}: ${err.shortMessage || err.message}`);
      await sleep(3000);
    }
  }
  fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
  console.log(`✅ Selesai. Sesi ini: ${sentCount} | total tercatat: ${Object.keys(state.sent).length}/${entries.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
