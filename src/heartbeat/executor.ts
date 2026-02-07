/**
 * Heartbeat executor
 *
 * Executes a single heartbeat check using Claude Agent SDK
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';
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
                (event) => {
                  logger.debug(
                    `${agent.agentId}: Tool used - ${event.tool.name}`
                  );
                },
              ],
            },
          ],
        },
      },
    })) {
      // Process messages
      if (message.type === 'text') {
        output += message.text;

        // Check for HEARTBEAT_OK protocol
        if (message.text.includes('HEARTBEAT_OK')) {
          logger.debug(`${agent.agentId}: HEARTBEAT_OK received`);
          shouldNotify = false;
        } else {
          shouldNotify = true;
        }
      } else if (message.type === 'session_id') {
        // Save session ID for next heartbeat
        sessionId = message.sessionId;
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
