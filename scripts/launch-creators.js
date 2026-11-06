#!/usr/bin/env node
/**
 * launch-creators.js — bikin 14 mission (1 per creator) lewat kontrak TzeroLaunchpad.
 *
 * Cara pakai (dari root repo, di Termux):
 *   node scripts/launch-creators.js --dry   # simulasi: cek saldo + estimate gas (tanpa kirim tx)
 *   node scripts/launch-creators.js --run   # kirim 14 tx create (jeda acak 15-45 detik antar creator)
 *
 * Butuh:
 *   - creators.env              (hasil scripts/extract-creators.js)
 *   - analysis/creators.json
 * Output:
 *   - analysis/missions_14.json (alamat mission + tx hash, per m1..m14)
 *   - Aman diulang: creator yang sudah punya mission di output akan di-skip.
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { createMission, buildUri } = require('../src/actions/launch');
const { ADDRS } = require('../src/contracts/client');

const ROOT = path.join(__dirname, '..');
const ANALYSIS = path.join(ROOT, 'analysis');
const OUT_PATH = path.join(ANALYSIS, 'missions_14.json');

function loadBareKeys(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return raw.replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(s => s.trim())
    .filter(l => /^(0x)?[0-9a-fA-F]{64}$/.test(l))
    .map(k => (k.startsWith('0x') ? k : '0x' + k));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  const run = argv.includes('--run');
  const dry = !run;

  const creators = JSON.parse(fs.readFileSync(path.join(ANALYSIS, 'creators.json'), 'utf8'));
  const envPath = path.join(ROOT, 'creators.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ creators.env tidak ada. Jalanin dulu: node scripts/extract-creators.js');
    process.exit(1);
  }
  const keys = loadBareKeys(envPath);
  if (keys.length !== creators.list.length) {
    console.error(`❌ creators.env isi ${keys.length} key, harusnya ${creators.list.length}.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com');
  let fee;
  try {
    const feeView = new ethers.Contract(ADDRS.launchpad, ['function CREATION_FEE() view returns (uint256)'], provider);
    fee = await feeView.CREATION_FEE();
  } catch (e) { fee = ethers.parseEther('0.0001'); }
  console.log(`⛽ Creation fee on-chain: ${ethers.formatEther(fee)} ETH | mode: ${dry ? 'DRY-RUN (tanpa kirim)' : 'LIVE (kirim tx!)'}`);

  fs.mkdirSync(ANALYSIS, { recursive: true });
  const out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')) : { missions: {} };

  for (let i = 0; i < creators.list.length; i++) {
    const c = creators.list[i];
    if (out.missions[c.mission] && out.missions[c.mission].address) {
      console.log(`⏭️  ${c.mission} sudah ada (${out.missions[c.mission].address}), skip`);
      continue;
    }

    const wallet = new ethers.Wallet(keys[i], provider);
    if (wallet.address.toLowerCase() !== c.addr.toLowerCase()) {
      console.error(`❌ Key #${i} = ${wallet.address}, tapi creator ${c.mission} = ${c.addr}. STOP — cek creators.env.`);
      process.exit(1);
    }

    const bal = await provider.getBalance(wallet.address);
    const minBal = fee + ethers.parseEther('0.00002');
    console.log(`\n[${i + 1}/${creators.list.length}] ${c.mission} ${c.name} (${c.ticker}) | ${wallet.address}`);
    console.log(`   saldo: ${ethers.formatEther(bal)} ETH`);
    if (bal < minBal) {
      console.error(`   ⚠️ saldo kurang (butuh ≥ ${ethers.formatEther(minBal)}), SKIP — top-up dulu`);
      continue;
    }

    try {
      if (dry) {
        const uri = buildUri({ name: c.name, ticker: c.ticker });
        const lp = new ethers.Contract(ADDRS.launchpad, LAUNCHPAD_MIN_ABI, wallet);
        const gas = await lp.create.estimateGas(c.name, c.ticker, uri, { value: fee });
        console.log(`   ✅ DRY OK — estimate gas: ${gas.toString()} units`);
      } else {
        const res = await createMission(wallet, { name: c.name, ticker: c.ticker, initialBuyEth: '0' });
        out.missions[c.mission] = {
          creator: wallet.address,
          address: res.missionAddress,
          txHash: res.txHash,
          name: c.name, ticker: c.ticker,
          createdAt: new Date().toISOString(),
        };
        fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 1));
        console.log(`   🚀 CREATE OK — mission: ${res.missionAddress}`);
        console.log(`   tx: ${res.txHash}`);
        await sleep(15000 + Math.random() * 30000);
      }
    } catch (err) {
      console.error(`   ❌ gagal: ${err.shortMessage || err.message}`);
    }
  }

  console.log(`\nSelesai. Output: ${OUT_PATH}`);
}

const LAUNCHPAD_MIN_ABI = ['function create(string,string,string) payable returns (address)'];
main().catch(e => { console.error(e); process.exit(1); });
