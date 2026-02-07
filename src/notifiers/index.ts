/**
 * Notifiers module
 *
 * Provides notification channels for sending messages to external services.
 * Currently supports:
 * - Console (default)
 * - Slack (via Bolt framework with Socket Mode)
 */

export { ConsoleNotifier } from './console';
export { createNotifier } from './factory';
export { SlackNotifier } from './slack';
export type { NotificationMessage, Notifier } from './types';
