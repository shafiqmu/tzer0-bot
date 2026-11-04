const { expectedPendingRewardsBehavior } = require('../../src/actions/stake');

describe('stake', () => {
  it('documents expected pending rewards behavior', () => {
    expect(expectedPendingRewardsBehavior()).toBe('returns uint256 rewards for address');
  });
});
