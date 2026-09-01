import { NextResponse, type NextRequest } from "next/server";
import { parseEnum, parseId, parsePositiveInt, toErrorResponse } from "@/lib/api";
import { SUBMISSION_STATUSES, listSubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";

const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;
const MAX_PAGE = 1_000_000;
const MAX_SEARCH_LENGTH = 64;

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const search = params.get("search")?.trim() ?? "";

    const result = await listSubmissions(
      {
        status: parseEnum(params.get("status"), "status", SUBMISSION_STATUSES),
        campaignId: params.get("campaignId") ? parseId(params.get("campaignId")!, "campaignId") : null,
        search: search === "" ? null : search.slice(0, MAX_SEARCH_LENGTH),
      },
      parsePositiveInt(params.get("page"), "page", 1, MAX_PAGE),
      parsePositiveInt(params.get("per"), "per", DEFAULT_PER_PAGE, MAX_PER_PAGE),
    );

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
