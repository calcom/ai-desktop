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
