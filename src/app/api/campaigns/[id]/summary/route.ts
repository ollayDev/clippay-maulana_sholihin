import { NextResponse, type NextRequest } from "next/server";
import { parseId, toErrorResponse } from "@/lib/api";
import { getCampaignSummary } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getCampaignSummary(parseId(id, "id")));
  } catch (error) {
    return toErrorResponse(error);
  }
}
