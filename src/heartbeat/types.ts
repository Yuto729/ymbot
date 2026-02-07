/**
 * Heartbeat related types
 */

import type { AgentConfig } from '../config';

export interface AgentState {
  agentId: string;
  config: AgentConfig;
  nextDueMs: number;
  intervalMs: number;
  sessionId?: string;
}

export interface HeartbeatResult {
  success: boolean;
  shouldNotify: boolean;
  output: string;
  error?: Error;
}
