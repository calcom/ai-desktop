export type BackendError = {
  code: string;
  message: string;
  required_scope?: string;
  retry_after_seconds?: number;
};

export function friendlyError(err: BackendError, baseUrl: string): string {
  switch (err.code) {
    case "missing_api_key":
    case "invalid_api_key":
      return "API key missing or invalid — update in Settings.";
    case "forbidden":
      return `API key is missing the \`${err.required_scope ?? "?"}\` scope.`;
    case "rate_limited":
      return `Hit the per-minute limit — try again in ${err.retry_after_seconds ?? 60}s.`;
    case "voices_not_configured":
      return "Backend has no voices configured.";
    case "validation_error":
      return `Invalid request: ${err.message}`;
    case "unknown_voice":
      return "Selected voice doesn't exist on the backend.";
    case "network":
      return `Backend offline at ${baseUrl}.`;
    case "request_cancelled":
      return "Request cancelled.";
    default:
      return err.message || "Something went wrong.";
  }
}

export class BackendErrorException extends Error {
  code: string;
  required_scope?: string;
  retry_after_seconds?: number;

  constructor(err: BackendError) {
    super(err.message);
    this.code = err.code;
    this.required_scope = err.required_scope;
    this.retry_after_seconds = err.retry_after_seconds;
  }

  asFriendly(baseUrl: string): string {
    return friendlyError(
      {
        code: this.code,
        message: this.message,
        required_scope: this.required_scope,
        retry_after_seconds: this.retry_after_seconds,
      },
      baseUrl,
    );
  }
}

export function backendErrorExceptionFromUnknown(
  value: unknown,
): BackendErrorException {
  if (value instanceof BackendErrorException) return value;
  return new BackendErrorException(backendErrorFromUnknown(value));
}

function backendErrorFromUnknown(value: unknown): BackendError {
  if (value instanceof Error) {
    return {
      code:
        value.message === "Request cancelled" ? "request_cancelled" : "unknown",
      message: value.message || "Something went wrong.",
    };
  }

  if (typeof value === "string") {
    return {
      code: value === "Request cancelled" ? "request_cancelled" : "unknown",
      message: value || "Something went wrong.",
    };
  }

  const record = asRecord(value);
  if (!record) {
    return { code: "unknown", message: "Something went wrong." };
  }

  const nested = asRecord(record.error);
  const source = nested ?? record;
  const code = typeof source.code === "string" ? source.code : "unknown";
  const message =
    typeof source.message === "string"
      ? source.message
      : safeStringify(source) ?? "Something went wrong.";

  return {
    code,
    message,
    required_scope:
      typeof source.required_scope === "string"
        ? source.required_scope
        : undefined,
    retry_after_seconds:
      typeof source.retry_after_seconds === "number"
        ? source.retry_after_seconds
        : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
