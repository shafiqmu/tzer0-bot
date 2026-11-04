const { loadConfig } = require('../src/config');
const { getAllSigners } = require('../src/wallet/manager');
const { getContracts } = require('../src/contracts/client');

async function monitor() {
  const cfg = loadConfig();
  const signers = getAllSigners(cfg);
  const rows = [];

  for (const signer of signers) {
    const eth = await signer.provider.getBalance(signer.address);
    const contracts = getContracts(signer);
    const t0 = new ethers.Contract(contracts.t0.target, ['function balanceOf(address) view returns (uint256)'], signer);
    const t0Bal = await t0.balanceOf(signer.address);
    rows.push({
      address: signer.address,
      eth: ethers.formatEther(eth),
      t0: ethers.formatUnits(t0Bal, 18),
    });
  }

  console.log(rows);
}

monitor().catch((e) => {
  console.error(e);
  process.exit(1);
});
