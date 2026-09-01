import { SqlParams, query } from "@/lib/db";
import { calculateEarning } from "@/lib/money";

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export type Platform = "tiktok" | "instagram" | "youtube";

export type SubmissionFilters = {
  status: SubmissionStatus | null;
  campaignId: bigint | null;
  search: string | null;
};

export type SubmissionListItem = {
  id: number;
  creatorUsername: string;
  campaignId: number;
  campaignTitle: string;
  platform: Platform;
  views: number;
  status: SubmissionStatus;
  submittedAt: string;
  estimatedGross: number;
  estimatedNet: number;
};

export type SubmissionPage = {
  data: SubmissionListItem[];
  page: number;
  per: number;
  total: number;
  totalPages: number;
};

type SubmissionRow = {
  id: bigint;
  platform: Platform;
  views: number;
  status: SubmissionStatus;
  submitted_at: Date;
  campaign_id: bigint;
  campaign_title: string;
  campaign_cpm: number;
  creator_username: string;
};

function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

function buildFilters(filters: SubmissionFilters, params: SqlParams) {
  const conditions: string[] = [];

  if (filters.status !== null) {
    conditions.push(`s.status = ${params.bind(filters.status)}`);
  }
  if (filters.campaignId !== null) {
    conditions.push(`s.campaign_id = ${params.bind(filters.campaignId.toString())}::bigint`);
  }
  if (filters.search !== null) {
    conditions.push(`cr.username ilike ${params.bind(`%${escapeLikePattern(filters.search)}%`)}`);
  }

  return conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";
}

export async function listSubmissions(
  filters: SubmissionFilters,
  page: number,
  per: number,
): Promise<SubmissionPage> {
  const pageParams = new SqlParams();
  const pageWhere = buildFilters(filters, pageParams);
  const limit = pageParams.bind(per);
  const offset = pageParams.bind((page - 1) * per);

  const countParams = new SqlParams();
  const countWhere = buildFilters(filters, countParams);
  const countJoin = filters.search !== null ? "join creators cr on cr.id = s.creator_id" : "";

  const [rows, totals] = await Promise.all([
    query<SubmissionRow>(
      `select s.id,
              s.platform,
              s.views,
              s.status,
              s.submitted_at,
              s.campaign_id,
              c.title    as campaign_title,
              c.cpm      as campaign_cpm,
              cr.username as creator_username
         from submissions s
         join creators  cr on cr.id = s.creator_id
         join campaigns c  on c.id  = s.campaign_id
         ${pageWhere}
        order by s.submitted_at desc, s.id desc
        limit ${limit} offset ${offset}`,
      pageParams.toArray(),
    ),
    query<{ total: bigint }>(
      `select count(*) as total from submissions s ${countJoin} ${countWhere}`,
      countParams.toArray(),
    ),
  ]);

  const total = Number(totals.rows[0]?.total ?? 0n);

  return {
    data: rows.rows.map(toListItem),
    page,
    per,
    total,
    totalPages: Math.max(1, Math.ceil(total / per)),
  };
}

function toListItem(row: SubmissionRow): SubmissionListItem {
  const earning = calculateEarning(BigInt(row.views), BigInt(row.campaign_cpm));

  return {
    id: Number(row.id),
    creatorUsername: row.creator_username,
    campaignId: Number(row.campaign_id),
    campaignTitle: row.campaign_title,
    platform: row.platform,
    views: row.views,
    status: row.status,
    submittedAt: row.submitted_at.toISOString(),
    estimatedGross: Number(earning.grossAmount),
    estimatedNet: Number(earning.netAmount),
  };
}
