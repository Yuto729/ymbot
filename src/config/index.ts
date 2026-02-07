/**
 * Configuration types and defaults
 */

export interface ActiveHours {
  start: string; // "HH:MM" format
  end: string; // "HH:MM" format
}

export interface AgentConfig {
  agentId: string;
  workspace: string;
  heartbeatInterval: number; // milliseconds
  activeHours?: ActiveHours;
}

export interface AppConfig {
  agents: AgentConfig[];
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
};
