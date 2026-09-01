import type { DatabaseError, PoolClient } from "pg";
import { ApiError, toSafeNumber } from "@/lib/api";
import { withTransaction } from "@/lib/db";
import { calculateEarning } from "@/lib/money";
import type { SubmissionStatus } from "@/lib/submissions";

const UNIQUE_VIOLATION = "23505";

export type ApproveResult = {
  submissionId: number;
  campaignId: number;
  views: number;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  remainingBudget: number;
};

type ClaimedSubmission = {
  creator_id: bigint;
  campaign_id: bigint;
  views: number;
};

type LockedCampaign = {
  cpm: number;
  status: "active" | "paused" | "closed";
  remaining_budget: bigint;
};

export async function approveSubmission(submissionId: bigint): Promise<ApproveResult> {
  try {
    return await withTransaction(async (tx) => {
      const claimed = await tx.query<ClaimedSubmission>(
        `update submissions
            set status = 'approved', reviewed_at = now()
          where id = $1::bigint and status = 'pending'
        returning creator_id, campaign_id, views`,
        [submissionId.toString()],
      );

      const submission = claimed.rows[0];
      if (!submission) throw await rejectUnclaimable(tx, submissionId);

      const campaigns = await tx.query<LockedCampaign>(
        `select cpm, status, remaining_budget from campaigns where id = $1::bigint for update`,
        [submission.campaign_id.toString()],
      );

      const campaign = campaigns.rows[0];
      if (!campaign) {
        throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign submission ini tidak ditemukan.");
      }
      if (campaign.status !== "active") {
        throw new ApiError(
          409,
          "CAMPAIGN_NOT_ACTIVE",
          `Campaign berstatus ${campaign.status}, tidak bisa membayar submission baru.`,
          { campaignStatus: campaign.status },
        );
      }

      const earning = calculateEarning(BigInt(submission.views), BigInt(campaign.cpm));

      const debited = await tx.query<{ remaining_budget: bigint }>(
        `update campaigns
            set remaining_budget = remaining_budget - $2::bigint
          where id = $1::bigint and remaining_budget >= $2::bigint
        returning remaining_budget`,
        [submission.campaign_id.toString(), earning.grossAmount.toString()],
      );

      const debitedCampaign = debited.rows[0];
      if (!debitedCampaign) {
        throw new ApiError(
          409,
          "INSUFFICIENT_BUDGET",
          "Sisa budget campaign tidak cukup untuk membayar submission ini secara penuh.",
          {
            requiredAmount: toSafeNumber(earning.grossAmount),
            remainingBudget: toSafeNumber(campaign.remaining_budget),
          },
        );
      }

      await tx.query(
        `insert into earnings
           (submission_id, creator_id, campaign_id, gross_amount, fee_amount, net_amount, views_at_approval)
         values ($1::bigint, $2::bigint, $3::bigint, $4::bigint, $5::bigint, $6::bigint, $7)`,
        [
          submissionId.toString(),
          submission.creator_id.toString(),
          submission.campaign_id.toString(),
          earning.grossAmount.toString(),
          earning.feeAmount.toString(),
          earning.netAmount.toString(),
          submission.views,
        ],
      );

      return {
        submissionId: Number(submissionId),
        campaignId: Number(submission.campaign_id),
        views: submission.views,
        grossAmount: toSafeNumber(earning.grossAmount),
        feeAmount: toSafeNumber(earning.feeAmount),
        netAmount: toSafeNumber(earning.netAmount),
        remainingBudget: toSafeNumber(debitedCampaign.remaining_budget),
      };
    });
  } catch (error) {
    if ((error as DatabaseError)?.code === UNIQUE_VIOLATION) {
      throw new ApiError(409, "SUBMISSION_NOT_PENDING", "Submission ini sudah pernah dibayar.");
    }
    throw error;
  }
}

async function rejectUnclaimable(tx: PoolClient, submissionId: bigint): Promise<ApiError> {
  const existing = await tx.query<{ status: SubmissionStatus }>(
    `select status from submissions where id = $1::bigint`,
    [submissionId.toString()],
  );

  const status = existing.rows[0]?.status;
  if (!status) {
    return new ApiError(404, "SUBMISSION_NOT_FOUND", "Submission tidak ditemukan.");
  }

  return new ApiError(
    409,
    "SUBMISSION_NOT_PENDING",
    status === "approved"
      ? "Submission ini sudah di-approve sebelumnya."
      : "Submission ini sudah di-reject dan tidak bisa di-approve.",
    { currentStatus: status },
  );
}
