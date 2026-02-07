/**
 * Heartbeat executor
 *
 * Executes a single heartbeat check using Claude Agent SDK
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getLogger } from '../utils';
import type { AgentState, HeartbeatResult } from './types';

const logger = getLogger('Executor');

/**
 * Execute a single heartbeat for an agent
 */
export async function executeHeartbeat(
  agent: AgentState
): Promise<HeartbeatResult> {
  const { workspace } = agent.config;

  // Load HEARTBEAT.md if exists
  const heartbeatPrompt = await loadHeartbeatPrompt(workspace);

  let shouldNotify = false;
  let output = '';
  let sessionId: string | undefined = agent.sessionId;

  try {
    // Execute heartbeat using Claude Agent SDK
    for await (const message of query({
      prompt: heartbeatPrompt,
      options: {
        // Working directory (where .claude/skills/ is located)
        cwd: workspace,

        // Load Skills from filesystem
        settingSources: ['user', 'project'],

        // Enable tools + Skills
        allowedTools: [
          'Read', // Read files
          'Bash', // Execute commands
          'Glob', // Find files
          'Grep', // Search files
          'Skill', // Enable Skills (.claude/skills/)
        ],

        // Session management (resume previous session)
        resume: agent.sessionId,

        // Permission mode
        permissionMode: 'acceptEdits',

        // Hooks (logging)
        hooks: {
          PostToolUse: [
            {
              hooks: [
                async (event: any) => {
                  logger.debug(
                    `${agent.agentId}: Tool used - ${event.tool?.name || 'unknown'}`
                  );
                  return {};
                },
              ],
            },
          ],
        },
      },
    })) {
      // Process messages
      const msg = message as any;

      if (msg.type === 'assistant' && msg.content) {
        // Extract text from assistant message
        for (const block of msg.content) {
          if (block.type === 'text') {
            output += block.text;

            // Check for HEARTBEAT_OK protocol
            if (block.text.includes('HEARTBEAT_OK')) {
              logger.debug(`${agent.agentId}: HEARTBEAT_OK received`);
              shouldNotify = false;
            } else {
              shouldNotify = true;
            }
          }
        }
      }

      // Store session ID if available
      if (msg.session_id) {
        sessionId = msg.session_id;
        logger.debug(`${agent.agentId}: Session ID updated`);
      }
    }

    // Update agent's session ID
    agent.sessionId = sessionId;

    // TODO(human): Implement notification logic here
    // This is where you decide how to notify the user (console, webhook, etc.)
    if (shouldNotify && output) {
      logger.info(`${agent.agentId}: Notification needed`);
      logger.info(output);
    }

    return {
      success: true,
      shouldNotify,
      output,
    };
  } catch (error) {
    return {
      success: false,
      shouldNotify: false,
      output: '',
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Load HEARTBEAT.md from workspace or return default prompt
 */
async function loadHeartbeatPrompt(workspace: string): Promise<string> {
  try {
    const heartbeatPath = join(workspace, 'HEARTBEAT.md');
    const content = await readFile(heartbeatPath, 'utf-8');
    return `HEARTBEAT.md を読み込んでリストされているチェックを実行:\n\n${content}`;
  } catch {
    // HEARTBEAT.md doesn't exist, use default prompt
    return '注意が必要な通知や更新がないか確認してください。問題がなければ HEARTBEAT_OK と返答してください。';
  }
}
