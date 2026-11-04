const { ethers } = require('ethers');
const { getContracts, ADDRS } = require('../contracts/client');

async function createMission(signer, { name, ticker, description, image, links, initialBuyEth }) {
  const contracts = getContracts(signer);
  const uri = buildUri({ name, ticker, description, image, links });
  const creationFee = ethers.parseEther('0.0001');
  const initialBuy = ethers.parseEther(initialBuyEth || '0');
  const value = creationFee + initialBuy;
  const tx = await contracts.launchpad.create(name, ticker, uri, { value });
  const receipt = await tx.wait();
  // The new mission/token address is emitted in the launchpad's create log.
  // We extract it from the known log shape instead of relying on an unresolved event name.
  const createLog = receipt.logs.find((l) => l.address === ADDRS.launchpad);
  if (!createLog) {
    console.log('raw receipt logs', receipt.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data })));
    throw new Error('Launchpad create log not found');
  }
  const missionAddress = ethers.getAddress('0x' + createLog.topics[1].slice(26));
  return { txHash: receipt.hash, missionAddress, receipt };
}

function buildUri({ name, ticker, description, image, links }) {
  const meta = { name, ticker, description, image, links };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString('base64')}`;
}

module.exports = { createMission, buildUri };
