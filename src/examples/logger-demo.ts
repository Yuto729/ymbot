/**
 * Logger demonstration
 *
 * Run with: npm run dev -- src/examples/logger-demo.ts
 */

import { logger, getLogger } from '../utils';

async function demonstrateLogger() {
  // Basic logging
  logger.debug('This is a debug message');
  logger.info('This is an info message');
  logger.warn('This is a warning message');
  logger.error('This is an error message');
  logger.success('This is a success message');

  // Logging with metadata
  logger.info('User logged in', {
    userId: '123',
    username: 'john_doe',
    timestamp: new Date().toISOString(),
  });

  // Child loggers
  const agentLogger = getLogger('Agent');
  agentLogger.info('Processing request');
  agentLogger.success('Request completed');

  const skillLogger = getLogger('Skill:Gmail');
  skillLogger.info('Checking unread emails');
  skillLogger.debug('Found 3 unread messages');

  // Error with stack trace
  try {
    throw new Error('Something went wrong!');
  } catch (error) {
    logger.error('Failed to process request', error);
  }

  // Simulating async operations
  logger.info('Starting long operation...');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  logger.success('Long operation completed');
}

demonstrateLogger().catch((error) => {
  logger.error('Demo failed', error);
  process.exit(1);
});
