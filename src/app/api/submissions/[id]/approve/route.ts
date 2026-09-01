import { NextResponse, type NextRequest } from "next/server";
import { parseId, toErrorResponse } from "@/lib/api";
import { approveSubmission } from "@/lib/approve";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const result = await approveSubmission(parseId(id, "id"));
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
