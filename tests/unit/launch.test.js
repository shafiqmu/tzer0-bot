const { buildUri } = require('../../src/actions/launch');

describe('launch', () => {
  it('builds launch calldata with correct params', () => {
    const params = { name: 'Test', ticker: 'TST', initialBuyEth: '0.001' };
    expect(() => buildUri(params)).not.toThrow();
  });
});
