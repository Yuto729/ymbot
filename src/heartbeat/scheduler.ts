/**
 * Heartbeat scheduler
 *
 * Manages periodic execution of heartbeat checks using setTimeout
 */

import type { AgentConfig } from '../config';
import type { Notifier } from '../notifiers';
import {
  AgentHookEvent,
  getLogger,
  type LogMetadata,
  serializeError,
} from '../utils';
import { executeHeartbeat } from './executor';
import type { AgentState } from './types';

const logger = getLogger('Scheduler');

export class HeartbeatScheduler {
  private agents = new Map<string, AgentState>();
  private timer?: NodeJS.Timeout;
  private running = false;
  private notifier: Notifier;

  constructor(configs: AgentConfig[], notifier: Notifier) {
    const now = Date.now();
    this.notifier = notifier;
    for (const config of configs) {
      this.agents.set(config.agentId, {
        agentId: config.agentId,
        config,
        nextDueMs: now + config.heartbeatInterval,
        intervalMs: config.heartbeatInterval,
      });
    }
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Scheduler already running');
      return;
    }

    this.running = true;
    await this.notifier.start();
    logger.info('Starting heartbeat scheduler');
    this.scheduleNext();
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.notifier) {
      await this.notifier.stop();
    }
    logger.info('Stopped heartbeat scheduler');
  }

  /**
   * Schedule the next heartbeat execution
   * Uses setTimeout (not setInterval) for precise timing
   */
  private scheduleNext(): void {
    if (!this.running) {
      return;
    }

    // Find the agent with the earliest due time
    let nextDueMs = Number.POSITIVE_INFINITY;
    let nextAgentId = '';

    for (const agent of this.agents.values()) {
      if (agent.nextDueMs < nextDueMs) {
        nextDueMs = agent.nextDueMs;
        nextAgentId = agent.agentId;
      }
    }

    if (nextDueMs === Number.POSITIVE_INFINITY) {
      logger.warn('No agents scheduled');
      return;
    }

    const delay = Math.max(0, nextDueMs - Date.now());

    logger.debug(
      `Next heartbeat: ${nextAgentId} in ${Math.round(delay / 1000)}s`
    );

    this.timer = setTimeout(async () => {
      await this.executeDueHeartbeats();
      this.scheduleNext(); // Reschedule after execution
    }, delay);

    // Keep process alive while timer is active
    // this.timer.unref?.();  // Commented out to keep process running
  }

  /**
   * Execute heartbeats for all due agents
   */
  private async executeDueHeartbeats(): Promise<void> {
    const now = Date.now();

    for (const agent of this.agents.values()) {
      // Skip if not due yet
      if (now < agent.nextDueMs) {
        continue;
      }

      // Check active hours
      if (!this.isWithinActiveHours(agent.config)) {
        logger.debug(`${agent.agentId}: Outside active hours, skipping`);
        agent.nextDueMs = Date.now() + agent.intervalMs;
        continue;
      }

      try {
        logger.info(`${agent.agentId}: Executing heartbeat`);
        const { success, shouldNotify, output, error } =
          await executeHeartbeat(agent);

        // Update session ID if returned
        if (success) {
          logger.success(`${agent.agentId}: Heartbeat completed`);
          if (shouldNotify && output) {
            try {
              await this.notifier.send({
                text: output,
                metadata: {
                  sessionId: agent.sessionId,
                  agentId: agent.agentId,
                  timestamp: new Date(),
                },
              });
              logger.debug('Notification sent successfully');
            } catch (notifError) {
              const metadata: LogMetadata = {
                eventType: AgentHookEvent.NOTIFICATION_ERROR,
                error: serializeError(notifError),
              };
              logger.error(
                'Failed to send notification',
                { sessionId: agent.sessionId, agentId: agent.agentId },
                metadata
              );
            }
          }
        } else {
          const metadata: LogMetadata = {
            eventType: AgentHookEvent.HEARTBEAT_ERROR,
            error: serializeError(error),
          };
          logger.error(
            `${agent.agentId}: Heartbeat failed`,
            { sessionId: agent.sessionId, agentId: agent.agentId },
            metadata
          );
        }

        // Schedule next execution (use current time, not loop start time)
        agent.nextDueMs = Date.now() + agent.intervalMs;
      } catch (error) {
        const metadata: LogMetadata = {
          eventType: AgentHookEvent.HEARTBEAT_ERROR,
          error: serializeError(error),
        };
        logger.error(
          `${agent.agentId}: Unexpected error`,
          { agentId: agent.agentId },
          metadata
        );
        // Still schedule next execution even on error
        agent.nextDueMs = Date.now() + agent.intervalMs;
      }
    }
  }

  /**
   * Check if current time is within active hours
   */
  private isWithinActiveHours(config: AgentConfig): boolean {
    if (!config.activeHours) {
      return true; // No restriction
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = config.activeHours.start
      .split(':')
      .map(Number);
    const [endHour, endMinute] = config.activeHours.end.split(':').map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * Get current state of all agents (for debugging)
   */
  getAgentStates(): AgentState[] {
    return Array.from(this.agents.values());
  }
}
