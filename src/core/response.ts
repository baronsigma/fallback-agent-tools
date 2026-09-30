import type { FallbackError } from './errors.js';

export type ExecutionMetadata = {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  metrics?: { outboundHttpRequests: number; paidSearchCalls: number; discoverySource: 'direct' | 'search_fallback' | 'none' };
};

export type ToolResponse<T> = {
  success: true;
  toolId: string;
  toolVersion: string;
  requestId: string;
  result: T;
  execution: ExecutionMetadata;
} | {
  success: false;
  toolId: string;
  toolVersion: string;
  requestId: string;
  error: FallbackError;
  execution: ExecutionMetadata;
};

export function successResponse<T>(args: {
  toolId: string; toolVersion: string; requestId: string; result: T;
  startedAt: Date; completedAt?: Date;
  executionMetrics?: NonNullable<ExecutionMetadata['metrics']>;
}): ToolResponse<T> {
  const completedAt = args.completedAt ?? new Date();
  return {
    success: true,
    toolId: args.toolId,
    toolVersion: args.toolVersion,
    requestId: args.requestId,
    result: args.result,
    execution: {
      startedAt: args.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: Math.max(0, completedAt.getTime() - args.startedAt.getTime()),
      ...(args.executionMetrics ? { metrics: args.executionMetrics } : {}),
    },
  };
}
