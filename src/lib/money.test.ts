import { describe, expect, it } from "vitest";
import { calculateEarning } from "@/lib/money";

const naiveFloatGross = (views: number, cpm: number) => BigInt(Math.floor((views / 1000) * cpm));

describe("calculateEarning", () => {
  it("matches the worked example from the spec", () => {
    expect(calculateEarning(12_345n, 1_500n)).toEqual({
      grossAmount: 18_517n,
      feeAmount: 3_704n,
      netAmount: 14_813n,
    });
  });

  it("stays exact where float arithmetic silently underpays", () => {
    expect(calculateEarning(18n, 1_500n).grossAmount).toBe(27n);
    expect(naiveFloatGross(18, 1_500)).toBe(26n);

    expect(calculateEarning(86n, 2_500n).grossAmount).toBe(215n);
    expect(naiveFloatGross(86, 2_500)).toBe(214n);
  });

  it("splits every rupiah it charges, creating and losing none", () => {
    for (const cpm of [900n, 1_500n, 2_500n]) {
      for (let views = 0n; views < 400n; views++) {
        const { grossAmount, feeAmount, netAmount } = calculateEarning(views, cpm);
        expect(feeAmount + netAmount).toBe(grossAmount);
        expect(netAmount).toBeGreaterThanOrEqual(0n);
        expect(feeAmount).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it("gives the rounding remainder to the platform, never to the creator", () => {
    const { grossAmount, netAmount } = calculateEarning(12_345n, 1_500n);
    expect(netAmount * 10n).toBeLessThanOrEqual(grossAmount * 8n);
    expect((netAmount + 1n) * 10n).toBeGreaterThan(grossAmount * 8n);
  });

  it("floors sub-rupiah earnings to zero rather than rounding up", () => {
    expect(calculateEarning(0n, 1_500n)).toEqual({
      grossAmount: 0n,
      feeAmount: 0n,
      netAmount: 0n,
    });
    expect(calculateEarning(1n, 900n).grossAmount).toBe(0n);
    expect(calculateEarning(1n, 1_500n)).toEqual({
      grossAmount: 1n,
      feeAmount: 1n,
      netAmount: 0n,
    });
  });

  it("holds at view counts far beyond int4", () => {
    expect(calculateEarning(8_100_000_000n, 2_500n).grossAmount).toBe(20_250_000_000n);
  });

  it("rejects inputs that cannot produce a valid payment", () => {
    expect(() => calculateEarning(-1n, 1_500n)).toThrow(RangeError);
    expect(() => calculateEarning(1_000n, 0n)).toThrow(RangeError);
    expect(() => calculateEarning(1_000n, -1_500n)).toThrow(RangeError);
  });
});
