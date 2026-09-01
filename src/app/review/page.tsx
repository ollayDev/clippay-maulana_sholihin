import { Suspense } from "react";
import { query } from "@/lib/db";
import ReviewTable, { type CampaignOption } from "./review-table";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const campaigns = await query<{ id: bigint; title: string }>(
    `select id, title from campaigns order by title`,
  );

  const options: CampaignOption[] = campaigns.rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
  }));

  return (
    <main>
      <h1>Review Submission</h1>
      <p className="subtitle">Approve submission untuk membayar creator dan memotong budget campaign.</p>
      <Suspense fallback={<div className="panel"><p className="state">Memuat…</p></div>}>
        <ReviewTable campaigns={options} />
      </Suspense>
    </main>
  );
}
