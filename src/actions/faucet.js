const { getBalance } = require('../contracts/client');

async function checkBalance(signer) {
  return await getBalance(signer);
}

module.exports = { checkBalance };
