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
 * Extract final response from agent output using ## Response marker
 * Falls back to full output if marker not found
 */
function extractFinalResponse(output: string): string {
  const marker = '## Response';
  const markerIndex = output.indexOf(marker);

  if (markerIndex === -1) {
    // Marker not found - return full output as fallback
    logger.debug('## Response marker not found, using full output');
    return output.trim();
  }

  // Extract content after marker
  const afterMarker = output.substring(markerIndex + marker.length).trim();
  logger.debug(
    `## Response marker found, extracted ${afterMarker.length} chars`
  );
  return afterMarker;
}

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

        // System prompt: Define agent behavior for heartbeat execution
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: `
重要な動作指示:
- すべての出力は日本語で行ってください
- 作業過程（ツール実行、分析、判断）は自由に記述してかまいません
- 最終的にユーザーに通知する内容は、必ず「## Response」というMarkdownヘッダーの下に記述してください
- ## Responseセクションには、HEARTBEAT.mdで指定された出力形式のみを記述してください
- メールの件名が英語の場合でも、説明文や「確認が必要です」などのメッセージは必ず日本語で記述してください
          `.trim(),
        },

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
                async (input: any, _toolUseID: string | undefined) => {
                  // Type guard for PostToolUse
                  if (input.hook_event_name !== 'PostToolUse') {
                    return {};
                  }

                  const toolName = input.tool_name || 'unknown';

                  // Log tool usage with structured metadata
                  if (
                    toolName === 'Bash' &&
                    input.tool_input &&
                    typeof input.tool_input === 'object' &&
                    'command' in input.tool_input
                  ) {
                    // Bash tool: include command in metadata
                    const command = (input.tool_input as { command: string })
                      .command;
                    logger.debug(
                      `Tool used: ${toolName}`,
                      { sessionId: input.session_id, agentId: agent.agentId },
                      { toolName, command }
                    );
                  } else if (input.tool_input) {
                    // Other tools: include full input
                    logger.debug(
                      `Tool used: ${toolName}`,
                      { sessionId: input.session_id, agentId: agent.agentId },
                      { toolName, toolInput: input.tool_input }
                    );
                  } else {
                    // No tool input
                    logger.debug(
                      `Tool used: ${toolName}`,
                      { sessionId: input.session_id, agentId: agent.agentId },
                      { toolName }
                    );
                  }

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

      // DEBUG: Log all message types and structure
      logger.debug(
        `Message type="${msg.type}" hasMessage=${!!msg.message}`,
        { sessionId: msg.session_id, agentId: agent.agentId },
        {
          messageType: msg.type,
          keys: Object.keys(msg),
        }
      );

      // Handle assistant messages (SDK uses 'message' property, not 'content')
      if (msg.type === 'assistant' && msg.message) {
        const message = msg.message;

        // Extract text from message content
        if (message.content && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (block.type === 'text') {
              const text = block.text;
              output += text;

              // Log assistant response
              logger.info(`💬 ${text}`, {
                sessionId: msg.session_id,
                agentId: agent.agentId,
              });

              // Check for HEARTBEAT_OK protocol
              if (text.includes('HEARTBEAT_OK')) {
                logger.success('✅ HEARTBEAT_OK received', {
                  sessionId: msg.session_id,
                  agentId: agent.agentId,
                });
                shouldNotify = false;
              } else {
                shouldNotify = true;
              }
            } else if (block.type === 'tool_use') {
              // Log tool use
              logger.debug(`🔧 Tool: ${block.name || 'unknown'}`, {
                sessionId: msg.session_id,
                agentId: agent.agentId,
              });
            }
          }
        }
      } else if (msg.type === 'result') {
        // Log and check result message
        const resultText = msg.result || '';
        logger.debug(`📊 Result: ${resultText.substring(0, 100)}...`, {
          sessionId: msg.session_id,
          agentId: agent.agentId,
        });

        // Extract final response from result (removes thinking/process)
        const finalResponse = extractFinalResponse(resultText);
        output = finalResponse;

        // Check result for HEARTBEAT_OK
        if (finalResponse.includes('HEARTBEAT_OK')) {
          logger.success('✅ HEARTBEAT_OK in result', {
            sessionId: msg.session_id,
            agentId: agent.agentId,
          });
          shouldNotify = false;
        }
      }

      // Store session ID if available (only log when changed)
      if (msg.session_id && msg.session_id !== sessionId) {
        const isFirst = !sessionId;
        sessionId = msg.session_id;
        if (isFirst) {
          logger.debug('🔑 Session started', {
            sessionId: msg.session_id,
            agentId: agent.agentId,
          });
        } else {
          logger.debug('🔑 Session ID changed', {
            sessionId: msg.session_id,
            agentId: agent.agentId,
          });
        }
      }
    }

    // Update agent's session ID
    agent.sessionId = sessionId;

    // Notification logic
    if (shouldNotify && output) {
      logger.warn('📧 Notification needed', {
        sessionId,
        agentId: agent.agentId,
      });
      logger.warn(
        `\n${'='.repeat(60)}\n${output}\n${'='.repeat(60)}`,
        {
          sessionId,
          agentId: agent.agentId,
        },
        {
          source: 'agent',
          messageType: 'agent_response',
        }
      );
    } else if (!shouldNotify) {
      logger.debug('No notification needed', {
        sessionId,
        agentId: agent.agentId,
      });
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
