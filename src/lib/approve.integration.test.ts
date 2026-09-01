import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { approveSubmission } from "@/lib/approve";
import { getPool, query } from "@/lib/db";

const canReachDatabase = async () => {
  if (!process.env.DATABASE_URL) return false;
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
};

const available = await canReachDatabase();

type Fixture = { campaignId: bigint; creatorId: bigint; submissionIds: bigint[] };

const fixtures: Fixture[] = [];

async function seedFixture(budget: bigint, views: number, count: number): Promise<Fixture> {
  const campaign = await query<{ id: bigint }>(
    `insert into campaigns (title, brand, cpm, total_budget, remaining_budget, status)
     values ('it-campaign', 'it-brand', 1500, $1::bigint, $1::bigint, 'active')
     returning id`,
    [budget.toString()],
  );
  const campaignId = campaign.rows[0]!.id;

  const creator = await query<{ id: bigint }>(
    `insert into creators (username, email) values ($1, $2) returning id`,
    [`it_creator_${crypto.randomUUID()}`, "it@example.com"],
  );
  const creatorId = creator.rows[0]!.id;

  const submissions = await query<{ id: bigint }>(
    `insert into submissions (creator_id, campaign_id, platform, video_url, views, status)
     select $1::bigint, $2::bigint, 'tiktok', 'https://example.com/it', $3::int, 'pending'
       from generate_series(1, $4::int)
     returning id`,
    [creatorId.toString(), campaignId.toString(), views, count],
  );

  const fixture = { campaignId, creatorId, submissionIds: submissions.rows.map((row) => row.id) };
  fixtures.push(fixture);
  return fixture;
}

afterAll(async () => {
  if (!available) return;
  for (const { campaignId, creatorId } of fixtures) {
    await query(`delete from earnings where campaign_id = $1::bigint`, [campaignId.toString()]);
    await query(`delete from submissions where campaign_id = $1::bigint`, [campaignId.toString()]);
    await query(`delete from campaigns where id = $1::bigint`, [campaignId.toString()]);
    await query(`delete from creators where id = $1::bigint`, [creatorId.toString()]);
  }
  await getPool().end();
});

describe.skipIf(!available)("approveSubmission under concurrency", () => {
  it("pays exactly once when the same submission is approved 20 times at once", async () => {
    const { campaignId, submissionIds } = await seedFixture(10_000_000n, 12_345, 1);
    const submissionId = submissionIds[0]!;

    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => approveSubmission(submissionId)),
    );

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(ApiError);
        expect((outcome.reason as ApiError).code).toBe("SUBMISSION_NOT_PENDING");
      }
    }

    const earnings = await query<{ count: bigint; gross: bigint }>(
      `select count(*) as count, coalesce(sum(gross_amount), 0)::bigint as gross
         from earnings where submission_id = $1::bigint`,
      [submissionId.toString()],
    );
    expect(Number(earnings.rows[0]!.count)).toBe(1);
    expect(earnings.rows[0]!.gross).toBe(18_517n);

    const campaign = await query<{ remaining_budget: bigint }>(
      `select remaining_budget from campaigns where id = $1::bigint`,
      [campaignId.toString()],
    );
    expect(campaign.rows[0]!.remaining_budget).toBe(10_000_000n - 18_517n);
  });

  it("never overspends the budget when many approvals race for it", async () => {
    const { campaignId, submissionIds } = await seedFixture(45_000n, 10_000, 10);

    const outcomes = await Promise.allSettled(
      submissionIds.map((id) => approveSubmission(id)),
    );

    const paid = outcomes.filter((o) => o.status === "fulfilled").length;
    expect(paid).toBe(3);

    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        expect((outcome.reason as ApiError).code).toBe("INSUFFICIENT_BUDGET");
      }
    }

    const state = await query<{ remaining_budget: bigint; gross: bigint; approved: bigint }>(
      `select c.remaining_budget,
              coalesce((select sum(gross_amount) from earnings where campaign_id = c.id), 0)::bigint as gross,
              (select count(*) from submissions where campaign_id = c.id and status = 'approved') as approved
         from campaigns c where c.id = $1::bigint`,
      [campaignId.toString()],
    );

    const row = state.rows[0]!;
    expect(row.remaining_budget).toBeGreaterThanOrEqual(0n);
    expect(row.gross).toBe(45_000n - row.remaining_budget);
    expect(Number(row.approved)).toBe(paid);
  });

  it("leaves the submission pending when the transaction rolls back", async () => {
    const { submissionIds } = await seedFixture(1n, 10_000, 1);
    const submissionId = submissionIds[0]!;

    await expect(approveSubmission(submissionId)).rejects.toMatchObject({
      code: "INSUFFICIENT_BUDGET",
    });

    const after = await query<{ status: string; reviewed_at: Date | null }>(
      `select status, reviewed_at from submissions where id = $1::bigint`,
      [submissionId.toString()],
    );
    expect(after.rows[0]!.status).toBe("pending");
    expect(after.rows[0]!.reviewed_at).toBeNull();
  });
});
