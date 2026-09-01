const PLATFORM_FEE_BPS = 2_000n;

const BPS_DENOMINATOR = 10_000n;
const VIEWS_PER_CPM_UNIT = 1_000n;

export type EarningBreakdown = {
  grossAmount: bigint;
  feeAmount: bigint;
  netAmount: bigint;
};

export function calculateEarning(views: bigint, cpm: bigint): EarningBreakdown {
  if (views < 0n) {
    throw new RangeError(`views must not be negative, got ${views}`);
  }
  if (cpm <= 0n) {
    throw new RangeError(`cpm must be greater than zero, got ${cpm}`);
  }

  const grossAmount = (views * cpm) / VIEWS_PER_CPM_UNIT;
  const netAmount = (grossAmount * (BPS_DENOMINATOR - PLATFORM_FEE_BPS)) / BPS_DENOMINATOR;

  return { grossAmount, feeAmount: grossAmount - netAmount, netAmount };
}
