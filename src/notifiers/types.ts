/**
 * Notifier interface for sending messages to external channels
 */

export interface NotificationMessage {
  text: string;
  metadata?: {
    sessionId?: string;
    agentId?: string;
    timestamp?: Date;
  };
}

export interface Notifier {
  /**
   * Send a notification message
   */
  send(message: NotificationMessage): Promise<void>;

  /**
   * Initialize the notifier (connect, authenticate, etc.)
   */
  start(): Promise<void>;

  /**
   * Cleanup resources (disconnect, etc.)
   */
  stop(): Promise<void>;
}
