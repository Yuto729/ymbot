/**
 * YMBot - Autonomous AI Agent
 *
 * Entry point for the agent server
 */

import { defaultConfig } from './config';
import { HeartbeatScheduler } from './heartbeat';
import { logger } from './utils';

async function main() {
  logger.info('YMBot starting...');

  // Initialize heartbeat scheduler
  const scheduler = new HeartbeatScheduler(defaultConfig.agents);

  // Start the scheduler
  scheduler.start();

  logger.success('YMBot is ready');
  logger.info('Press Ctrl+C to stop');

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Failed to start YMBot', error);
  process.exit(1);
});
