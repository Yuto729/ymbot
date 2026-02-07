/**
 * YMBot - Autonomous AI Agent
 *
 * Entry point for the agent server
 */

import 'dotenv/config';

import { defaultConfig } from './config';
import { HeartbeatScheduler } from './heartbeat';
import { createNotifier } from './notifiers';
import { logger } from './utils';

async function main() {
  logger.info('YMBot starting...');

  // Initialize heartbeat scheduler
  const notifier = createNotifier(defaultConfig);
  const scheduler = new HeartbeatScheduler(defaultConfig.agents, notifier);

  // Start the scheduler
  await scheduler.start();

  logger.success('YMBot is ready');
  logger.info('Press Ctrl+C to stop');

  // Graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Shutting down...');
    await scheduler.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await scheduler.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Failed to start YMBot', error);
  process.exit(1);
});
