import { ZodError } from "zod";
import { DomainError } from "@/core/errors";

/**
 * Every API route answers failures with this shape:
 *   { "error": { "message": string, "code": string, "details"?: [...] } }
 */
export type ApiErrorBody = {
  error: {
    message: string;
    code: string;
    details?: { field: string; message: string }[];
  };
};

const DOMAIN_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  VALIDATION: 400,
  CONFLICT: 409,
};

export function jsonError(
  message: string,
  code: string,
  status: number,
  details?: { field: string; message: string }[],
): Response {
  const body: ApiErrorBody = { error: { message, code } };
  if (details?.length) body.error.details = details;
  return Response.json(body, { status });
}

export function jsonOk<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/**
 * Maps anything thrown by the core layer onto the response contract. Unknown
 * failures are logged server-side and reported as a generic 500 so internal
 * details never leak to the client.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join(".") || "_",
      message: issue.message,
    }));
    // Surface the first issue's own message (e.g. "نام باید حداکثر ۸۰ کاراکتر
    // باشد") instead of a generic line, so a single-field form tells the admin
    // exactly what is wrong. The full list still travels in `details`.
    const message = error.issues[0]?.message ?? "اطلاعات ارسالی معتبر نیست";
    return jsonError(message, "VALIDATION_ERROR", 400, details);
  }

  if (error instanceof DomainError) {
    return jsonError(
      error.message,
      error.code,
      DOMAIN_STATUS[error.code] ?? 400,
    );
  }

  // Malformed JSON body.
  if (error instanceof SyntaxError) {
    return jsonError("بدنه درخواست JSON معتبر نیست", "INVALID_JSON", 400);
  }

  console.error("[api] unhandled error:", error);
  return jsonError("خطای داخلی سرور", "INTERNAL_ERROR", 500);
}

/** Parses a JSON body, tolerating an empty one (e.g. DELETE with no body). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text);
}

/** Collects query params into a plain object for Zod to validate. */
export function queryToObject(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}
