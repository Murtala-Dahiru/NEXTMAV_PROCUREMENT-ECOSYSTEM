// NextMav Procure — typed application errors.
//
// Services throw these; the route wrapper in `http.ts` turns them into responses.
// Business rules therefore live in the service layer and stay testable, instead of
// being expressed as ad-hoc NextResponse calls scattered through route handlers.

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "BUDGET_EXCEEDED"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  BUDGET_EXCEEDED: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const unauthenticated = (m = "Authentication required") => new AppError("UNAUTHENTICATED", m);
export const forbidden = (m = "You do not have permission to perform this action") => new AppError("FORBIDDEN", m);
export const notFound = (m = "Not found") => new AppError("NOT_FOUND", m);
export const validation = (m: string, details?: unknown) => new AppError("VALIDATION", m, details);
export const conflict = (m: string, details?: unknown) => new AppError("CONFLICT", m, details);
export const invalidTransition = (m: string, details?: unknown) => new AppError("INVALID_TRANSITION", m, details);
export const budgetExceeded = (m: string, details?: unknown) => new AppError("BUDGET_EXCEEDED", m, details);
export const rateLimited = (m = "Too many requests") => new AppError("RATE_LIMITED", m);
