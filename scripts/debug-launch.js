const { ethers } = require('ethers');
const fs = require('fs');

async function main() {
  const provider = new ethers.JsonRpcProvider('https://sepolia.base.org');
  const key = JSON.parse(fs.readFileSync('./test-wallets/tzer0-bot-test.json', 'utf8')).privateKey;
  const wallet = new ethers.Wallet(key, provider);
  const launchpad = new ethers.Contract(
    '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c',
    [
      'function launch(string,string,string,uint256) payable returns (address)',
      'function creationFee() view returns (uint256)'
    ],
    wallet
  );

  const bal = await provider.getBalance(wallet.address);
  console.log('wallet', wallet.address);
  console.log('balance', ethers.formatEther(bal), 'ETH');

  try {
    const fee = await launchpad.creationFee();
    console.log('creationFee', ethers.formatEther(fee), 'ETH');
  } catch (err) {
    console.log('creationFee call failed:', err.message);
  }

  const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'Hermes Test', ticker: 'HTST' })).toString('base64');
  const value = ethers.parseEther('0.0001');

  try {
    console.log('trying estimateGas launch with value', ethers.formatEther(value));
    const gas = await launchpad.launch.estimateGas('Hermes Test', 'HTST', uri, 0, { value });
    console.log('launch gas estimate', gas.toString());
  } catch (err) {
    console.log('launch estimate failed:', err.message);
    console.log('shortMessage', err.shortMessage);
    console.log('code', err.code);
    console.log('info', JSON.stringify(err.info, null, 2));
  }
}

main().catch(console.error);
