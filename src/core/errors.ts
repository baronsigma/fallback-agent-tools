export type FallbackError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export class ToolUnavailableError extends Error {
  readonly code = 'TOOL_UNAVAILABLE';
  constructor(readonly toolId: string) {
    super(`Tool '${toolId}' is currently unavailable.`);
    this.name = 'ToolUnavailableError';
  }
}
