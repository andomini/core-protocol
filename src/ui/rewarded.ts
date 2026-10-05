// Rewarded-ad seam for the UI. M6 registers the real portal service in the Phaser registry under
// 'rewarded'; until then a local stub grants immediately (the dev/local behaviour).

export type RewardedPlacement = 'revive' | 'doubleBits' | 'reroll' | 'freePack' | 'boost' | 'offlineDouble';

export interface RewardedAds {
  rewardedAd(placement: RewardedPlacement): Promise<boolean>;
}

export const localRewarded: RewardedAds = {
  rewardedAd: () => Promise.resolve(true),
};
