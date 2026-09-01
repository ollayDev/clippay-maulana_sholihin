import { ApiError, toSafeNumber } from "@/lib/api";
import { query } from "@/lib/db";

export type CampaignSummary = {
  campaignId: number;
  title: string;
  brand: string;
  cpm: number;
  status: string;
  totalBudget: number;
  remainingBudget: number;
  spentBudget: number;
  submissions: { total: number; pending: number; approved: number; rejected: number };
  payouts: { count: number; gross: number; fee: number; net: number };
};

type SummaryRow = {
  id: bigint;
  title: string;
  brand: string;
  cpm: number;
  status: string;
  total_budget: bigint;
  remaining_budget: bigint;
  total_submissions: bigint;
  pending_count: bigint;
  approved_count: bigint;
  rejected_count: bigint;
  payout_count: bigint;
  gross_paid: bigint;
  fee_collected: bigint;
  net_paid: bigint;
};

export async function getCampaignSummary(campaignId: bigint): Promise<CampaignSummary> {
  const result = await query<SummaryRow>(
    `select c.id,
            c.title,
            c.brand,
            c.cpm,
            c.status,
            c.total_budget,
            c.remaining_budget,
            s.total_submissions,
            s.pending_count,
            s.approved_count,
            s.rejected_count,
            e.payout_count,
            e.gross_paid,
            e.fee_collected,
            e.net_paid
       from campaigns c
       left join lateral (
         select count(*)                                        as total_submissions,
                count(*) filter (where status = 'pending')      as pending_count,
                count(*) filter (where status = 'approved')     as approved_count,
                count(*) filter (where status = 'rejected')     as rejected_count
           from submissions
          where campaign_id = c.id
       ) s on true
       left join lateral (
         select count(*)                                as payout_count,
                coalesce(sum(gross_amount), 0)::bigint  as gross_paid,
                coalesce(sum(fee_amount), 0)::bigint    as fee_collected,
                coalesce(sum(net_amount), 0)::bigint    as net_paid
           from earnings
          where campaign_id = c.id
       ) e on true
      where c.id = $1::bigint`,
    [campaignId.toString()],
  );

  const row = result.rows[0];
  if (!row) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign tidak ditemukan.");

  return {
    campaignId: Number(row.id),
    title: row.title,
    brand: row.brand,
    cpm: row.cpm,
    status: row.status,
    totalBudget: toSafeNumber(row.total_budget),
    remainingBudget: toSafeNumber(row.remaining_budget),
    spentBudget: toSafeNumber(row.total_budget - row.remaining_budget),
    submissions: {
      total: Number(row.total_submissions),
      pending: Number(row.pending_count),
      approved: Number(row.approved_count),
      rejected: Number(row.rejected_count),
    },
    payouts: {
      count: Number(row.payout_count),
      gross: toSafeNumber(row.gross_paid),
      fee: toSafeNumber(row.fee_collected),
      net: toSafeNumber(row.net_paid),
    },
  };
}
