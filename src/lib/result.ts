export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVITE_INVALID"
  | "INTERNAL";

export type Result<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): { ok: false; code: ErrorCode; message: string } => ({
  ok: false,
  code,
  message,
});
