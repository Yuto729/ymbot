/**
 * Slack notifier using Bolt framework with Socket Mode
 */

import { App, LogLevel } from '@slack/bolt';
import { getLogger } from '../utils';
import type { NotificationMessage, Notifier } from './types';

const logger = getLogger('SlackNotifier');

export interface SlackNotifierConfig {
  botToken: string;
  appToken: string;
  channel: string;
}

export class SlackNotifier implements Notifier {
  private app: App;
  private channel: string;

  constructor(config: SlackNotifierConfig) {
    this.channel = config.channel;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
      // Use LogLevel enum from @slack/bolt
      logLevel:
        process.env.NODE_ENV === 'production' ? LogLevel.WARN : LogLevel.DEBUG,
    });

    // Setup event listeners (Phase 2: bidirectional communication)
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for bidirectional communication
   * Phase 1: Empty implementations with TODO comments
   * Phase 2: Implement actual handlers
   */
  private setupEventListeners(): void {
    // TODO(Phase 2): Implement message handler
    // this.app.message(async ({ message, say }) => {
    //   // Handle incoming messages
    // });

    // TODO(Phase 2): Implement app_mention handler
    // this.app.event('app_mention', async ({ event, say }) => {
    //   // Handle mentions
    // });

    logger.debug('Event listeners registered (currently no-op)');
  }

  async send(message: NotificationMessage): Promise<void> {
    const { text, metadata } = message;

    try {
      // Format message (no metadata footer)
      const formattedText = this.formatMessage(text);

      // Send to Slack
      const result = await this.app.client.chat.postMessage({
        channel: this.channel,
        text: formattedText,
        // Enable mrkdwn formatting
        mrkdwn: true,
      });

      logger.info(
        `Message sent to Slack channel ${this.channel}`,
        metadata
          ? { sessionId: metadata.sessionId, agentId: metadata.agentId }
          : undefined,
        { ts: result.ts }
      );
    } catch (error) {
      logger.error(
        'Failed to send Slack message',
        metadata
          ? { sessionId: metadata.sessionId, agentId: metadata.agentId }
          : undefined,
        error
      );
      throw error;
    }
  }

  /**
   * Format message (metadata footer removed per user request)
   */
  private formatMessage(text: string): string {
    // Simply return the text without metadata footer
    return text;
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting Slack Bolt app (Socket Mode)...');
      // app.start() returns the port number for HTTP mode,
      // but in Socket Mode it connects via WebSocket
      await this.app.start();
      logger.success(`Slack Bolt app connected via Socket Mode`);
      logger.info(`Notifications will be sent to channel: ${this.channel}`);
    } catch (error) {
      logger.error('Failed to start Slack Bolt app', undefined, error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping Slack Bolt app...');
      await this.app.stop();
      logger.info('Slack Bolt app stopped');
    } catch (error) {
      logger.error('Failed to stop Slack Bolt app', undefined, error);
      throw error;
    }
  }
}
