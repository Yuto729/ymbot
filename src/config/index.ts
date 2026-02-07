/**
 * Configuration types and defaults
 */

export interface ActiveHours {
  start: string; // "HH:MM" format
  end: string; // "HH:MM" format
}

export interface SlackConfig {
  enabled: boolean;
  botToken: string; // xoxb-...
  appToken: string; // xapp-...
  channel: string; // Channel ID or name
}

export interface NotificationConfig {
  slack?: SlackConfig;
}

export interface AgentConfig {
  agentId: string;
  workspace: string;
  heartbeatInterval: number; // milliseconds
  activeHours?: ActiveHours;
}

export interface AppConfig {
  agents: AgentConfig[];
  notifications?: NotificationConfig;
}

// Default configuration
export const defaultConfig: AppConfig = {
  agents: [
    {
      agentId: 'gmail-checker',
      workspace: process.cwd(),
      heartbeatInterval: 30 * 1000, // 30 seconds (for testing)
      // activeHours: {
      //   start: '08:00',
      //   end: '22:00',
      // },
    },
  ],
  notifications: {
    slack: {
      enabled: process.env.SLACK_ENABLED === 'true',
      botToken: process.env.SLACK_BOT_TOKEN || '',
      appToken: process.env.SLACK_APP_TOKEN || '',
      channel: process.env.SLACK_CHANNEL || '#notifications',
    },
  },
};
