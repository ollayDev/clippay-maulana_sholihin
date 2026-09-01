import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "SUBMISSION_NOT_FOUND"
  | "CAMPAIGN_NOT_FOUND"
  | "SUBMISSION_NOT_PENDING"
  | "CAMPAIGN_NOT_ACTIVE"
  | "INSUFFICIENT_BUDGET"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, ...error.details } },
      { status: error.status },
    );
  }

  console.error("[api] unhandled error", error);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Terjadi kesalahan di server." } },
    { status: 500 },
  );
}

export function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ApiError(500, "INTERNAL_ERROR", `Value ${value} exceeds safe JSON integer range.`);
  }
  return Number(value);
}

export function parseId(raw: string, field: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, "BAD_REQUEST", `${field} harus berupa angka bulat positif.`);
  }
  const id = BigInt(raw);
  if (id <= 0n) {
    throw new ApiError(400, "BAD_REQUEST", `${field} harus lebih besar dari nol.`);
  }
  return id;
}

export function parsePositiveInt(
  raw: string | null,
  field: string,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(400, "BAD_REQUEST", `${field} harus berupa angka bulat positif.`);
  }
  const value = Number(raw);
  if (value < 1) {
    throw new ApiError(400, "BAD_REQUEST", `${field} minimal 1.`);
  }
  return Math.min(value, max);
}

export function parseEnum<T extends string>(
  raw: string | null,
  field: string,
  allowed: readonly T[],
): T | null {
  if (raw === null || raw === "") return null;
  if (!allowed.includes(raw as T)) {
    throw new ApiError(400, "BAD_REQUEST", `${field} harus salah satu dari: ${allowed.join(", ")}.`);
  }
  return raw as T;
}
