export interface ApiFieldError {
  field: string;
  message: string;
}

/** Error envelope returned by the backend's global exception filter. */
export interface ApiErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  /** Machine-readable code, e.g. TOKEN_EXPIRED, EMAIL_TAKEN, VALIDATION_FAILED. */
  code?: string;
  errors?: ApiFieldError[];
  details?: unknown;
  path: string;
  method: string;
  timestamp: string;
}

export function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ApiErrorResponse>).statusCode === 'number' &&
    'message' in value
  );
}

/** Thrown by the HTTP client for network failures (status 0) and non-2xx responses. */
export class ApiError extends Error {
  readonly status: number;
  readonly response?: ApiErrorResponse;

  constructor(
    message: string,
    status: number,
    response?: ApiErrorResponse,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.response = response;
  }

  get code(): string | undefined {
    return this.response?.code;
  }

  /** Field-level validation messages keyed by field name (first message per field). */
  get fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const { field, message } of this.response?.errors ?? []) {
      result[field] ??= message;
    }
    return result;
  }

  static fromResponse(status: number, body: unknown): ApiError {
    if (isApiErrorResponse(body)) {
      const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
      return new ApiError(message, status, body);
    }
    return new ApiError(`Request failed with status ${status}`, status);
  }
}

/** A user-facing message for any error thrown by the API client. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return 'Unable to reach the server. Check your connection and try again.';
    }
    if (error.status >= 500) {
      return 'Something went wrong on our side. Please try again.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
