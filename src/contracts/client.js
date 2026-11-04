const { ethers } = require('ethers');

const ADDRS = {
  launchpad: '0xbce48917C41BB45Ad15f859E4Bf0e4EEa74bAd5c',
  router: '0x21BbD201c69d0091707d0367D3AD6875cEc150e1',
  staking: '0x221De22612E65093Fc43164dae84fa6Bd79E6239',
  t0: '0x15522727F10Ea666Ebb4fD4c23B394580F10FED4',
  weth: '0x4200000000000000000000000000000000000006',
};

const LAUNCHPAD_ABI = [
  'function create(string name, string ticker, string uri) payable returns (address mission)',
  'function buy(address mission, uint256 minTokens) payable',
  'function sell(address mission, uint256 tokenAmount, uint256 minNative)',
];

const ROUTER_ABI = [
  'function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) payable returns (uint256 amountOut)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256 amountOut)',
];

const STAKING_ABI = [
  'function stake(uint256 amount)',
  'function unstake(uint256 amount)',
  'function claim()',
  'function pending(address) view returns (uint256)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address, uint256)',
  'function allowance(address, address) view returns (uint256)',
];

function getContracts(signer) {
  return {
    launchpad: new ethers.Contract(ADDRS.launchpad, LAUNCHPAD_ABI, signer),
    router: new ethers.Contract(ADDRS.router, ROUTER_ABI, signer),
    staking: new ethers.Contract(ADDRS.staking, STAKING_ABI, signer),
    t0: new ethers.Contract(ADDRS.t0, ERC20_ABI, signer),
    weth: new ethers.Contract(ADDRS.weth, ERC20_ABI, signer),
  };
}

async function getBalance(signer) {
  return await signer.provider.getBalance(signer.address);
}

module.exports = { getContracts, getBalance, ADDRS };
