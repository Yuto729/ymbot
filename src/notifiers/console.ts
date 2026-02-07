/**
 * Console notifier - outputs messages to stdout
 */

import { getLogger } from '../utils';
import type { NotificationMessage, Notifier } from './types';

const logger = getLogger('ConsoleNotifier');

export class ConsoleNotifier implements Notifier {
  async send(message: NotificationMessage): Promise<void> {
    const { text, metadata } = message;

    // Format output
    const box = '='.repeat(60);
    const header = metadata?.agentId
      ? `📧 Notification from ${metadata.agentId}`
      : '📧 Notification';

    logger.warn(
      header,
      metadata
        ? { sessionId: metadata.sessionId, agentId: metadata.agentId }
        : undefined
    );
    logger.warn(
      `\n${box}\n${text}\n${box}`,
      metadata
        ? { sessionId: metadata.sessionId, agentId: metadata.agentId }
        : undefined
    );
  }

  async start(): Promise<void> {
    logger.info('Console notifier ready');
  }

  async stop(): Promise<void> {
    logger.debug('Console notifier stopped');
  }
}
