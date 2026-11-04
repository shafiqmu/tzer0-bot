const { ethers } = require('ethers');
const { getContracts, ADDRS } = require('../contracts/client');

function randomString(len = 4) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function resolveLaunch(input) {
  const name = !input.name || input.name.toLowerCase() === 'random' ? `Mission-${randomString(4)}` : input.name;
  const ticker = !input.ticker || input.ticker.toLowerCase() === 'random' ? `TST-${randomString(4)}` : input.ticker;
  return { ...input, name, ticker };
}

async function createMission(signer, { name, ticker, description, image, links, initialBuyEth }) {
  const contracts = getContracts(signer);
  const uri = buildUri({ name, ticker, description, image, links });
  const creationFee = ethers.parseEther('0.0001');
  const initialBuy = ethers.parseEther(initialBuyEth || '0');
  const value = creationFee + initialBuy;
  const tx = await contracts.launchpad.create(name, ticker, uri, { value });
  const receipt = await tx.wait();
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

module.exports = { createMission, buildUri, resolveLaunch };
