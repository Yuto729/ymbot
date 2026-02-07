/**
 * Notifier factory - creates notifiers based on configuration
 */

import type { AppConfig } from '../config';
import {
  AgentHookEvent,
  getLogger,
  type LogMetadata,
  serializeError,
} from '../utils';
import { ConsoleNotifier } from './console';
import { SlackNotifier } from './slack';
import type { Notifier } from './types';

const logger = getLogger('NotifierFactory');

export function createNotifier(config: AppConfig): Notifier {
  const slackConfig = config.notifications?.slack;

  // Try to create Slack notifier if enabled
  if (slackConfig?.enabled) {
    if (!slackConfig.botToken || !slackConfig.appToken) {
      logger.warn(
        'Slack notifier is enabled but tokens are missing. Falling back to console notifier.'
      );
      logger.warn(
        'Please set SLACK_BOT_TOKEN and SLACK_APP_TOKEN environment variables.'
      );
      return new ConsoleNotifier();
    }

    try {
      logger.info(
        `Creating Slack notifier for channel: ${slackConfig.channel}`
      );
      return new SlackNotifier({
        botToken: slackConfig.botToken,
        appToken: slackConfig.appToken,
        channel: slackConfig.channel,
      });
    } catch (error) {
      const metadata: LogMetadata = {
        eventType: AgentHookEvent.NOTIFIER_LIFECYCLE,
        error: serializeError(error),
      };
      logger.error(
        'Failed to create Slack notifier, falling back to console',
        undefined,
        metadata
      );
      return new ConsoleNotifier();
    }
  }

  // Default to console notifier
  logger.info('Using console notifier (Slack not enabled)');
  return new ConsoleNotifier();
}
