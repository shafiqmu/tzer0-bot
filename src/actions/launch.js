const { ethers } = require('ethers');
const { getContracts, ADDRS } = require('../contracts/client');

const PROJECT_STYLES = [
  () => {
    const a = ['Aether','Nexus','Vortex','Orbit','Prism','Cipher','Echo','Flux','Forge','Glyph','Hive','Ion','Jade','Kite','Luma','Mint','Nova','Onyx','Pulse','Quill'];
    const b = ['AI','DAO','DeFi','Fi','Lab','Net','One','OS','Pro','Up','X','Z',''];
    return `${a[Math.floor(Math.random()*a.length)]}${b[Math.floor(Math.random()*b.length)]}`;
  },
  () => {
    const a = ['Arc','Aur','Bel','Cor','Dra','Ecl','Fal','Gal','Hel','Ign','Jov','Kor','Lum','Myr','Neb','Orb','Pax','Qua','Rex','Sol'];
    const b = ['antis','bridge','chain','core','dao','ex','finance','ify','in','ium','lab','link','mint','net','on','protocol','sys','tron','verse','x'];
    return `${a[Math.floor(Math.random()*a.length)]}${b[Math.floor(Math.random()*b.length)]}`;
  },
  () => {
    const words = ['Aurora','Bastion','Cipher','Drift','Ember','Fathom','Grove','Haven','Iris','Jade','Kernel','Lattice','Meridian','Nexus','Obsidian','Pillar','Quasar','Ridge','Spire','Tide'];
    return words[Math.floor(Math.random()*words.length)];
  },
  () => {
    const a = ['Alpha','Beta','Gamma','Delta','Omega','Sigma','Theta','Zeta','Kappa','Lambda'];
    const b = ['Capital','Chain','DAO','Finance','Labs','Network','Protocol','Systems','Ventures','Zero'];
    return `${a[Math.floor(Math.random()*a.length)]} ${b[Math.floor(Math.random()*b.length)]}`;
  },
  () => {
    const words = ['Arcane','Astral','Aurum','Boreas','Calypso','Daedalus','Elysian','Fenrir','Goliath','Hyperion','Icarus','Janus','Kronos','Leviathan','Morpheus','Nebula','Oberon','Pandora','Quasar','Ragnarok'];
    return words[Math.floor(Math.random()*words.length)];
  }
];

function randomString(len = 4) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: len }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function resolveLaunch(input) {
  const name = !input.name || input.name.toLowerCase() === 'random'
    ? PROJECT_STYLES[Math.floor(Math.random() * PROJECT_STYLES.length)]()
    : input.name;
  const ticker = !input.ticker || input.ticker.toLowerCase() === 'random'
    ? randomString(3)
    : input.ticker;
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
