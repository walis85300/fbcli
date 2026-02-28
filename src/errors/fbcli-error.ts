export type FbCliErrorCode =
  | "INVALID_NODE_TYPE"
  | "INVALID_GRAPH_ID"
  | "AMBIGUOUS_GRAPH_ID"
  | "EDGE_NOT_SUPPORTED"
  | "UNSUPPORTED_IN_MVP"
  | "MISSING_TOKEN"
  | "MISSING_APP_CREDENTIALS"
  | "AUTH_CALLBACK_LISTENER_ERROR"
  | "AUTH_CALLBACK_TIMEOUT"
  | "AUTH_STATE_MISMATCH"
  | "AUTH_TOKEN_EXCHANGE_FAILED"
  | "AUTH_STORAGE_ERROR"
  | "META_API_ERROR";

export class FbCliError extends Error {
  readonly code: FbCliErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: FbCliErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FbCliError";
    this.code = code;
    this.details = details;
  }
}

export type StructuredError = {
  code: FbCliErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export function toStructuredError(error: unknown): StructuredError {
  if (error instanceof FbCliError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: "META_API_ERROR",
      message: error.message,
    };
  }

  return {
    code: "META_API_ERROR",
    message: "Unknown error",
  };
}
