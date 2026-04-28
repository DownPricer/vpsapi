export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_IMPLEMENTED"
  | "TENANT_NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiSuccessBody<T = unknown> {
  success: true;
  data?: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailureBody {
  success: false;
  error: ApiErrorBody;
  meta?: Record<string, unknown>;
}

export type ApiResponseBody<T = unknown> = ApiSuccessBody<T> | ApiFailureBody;
