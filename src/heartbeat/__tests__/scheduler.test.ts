/**
 * Heartbeat Scheduler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatScheduler } from '../scheduler';
import type { AgentConfig } from '../../config';
import { executeHeartbeat } from '../executor';

// Get mocked function type
const mockExecuteHeartbeat = vi.mocked(executeHeartbeat);

// Mock the executor module
vi.mock('../executor', () => ({
  executeHeartbeat: vi.fn(),
}));

// Mock Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

describe('HeartbeatScheduler', () => {
  beforeEach(() => {
    // Enable fake timers
    vi.useFakeTimers();
    // Clear all mock state
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore real timers
    vi.useRealTimers();
  });

  describe('基本的な起動と停止', () => {
    it('スケジューラーが正しく起動される', () => {
      const config: AgentConfig = {
        agentId: 'test-agent',
        workspace: '/tmp/test',
        heartbeatInterval: 5000, // 5秒
      };

      const scheduler = new HeartbeatScheduler([config]);
      scheduler.start();

      // スケジューラーが起動していることを確認
      const states = scheduler.getAgentStates();
      expect(states).toHaveLength(1);
      expect(states[0].agentId).toBe('test-agent');

      scheduler.stop();
    });

    it('スケジューラーが正しく停止される', () => {
      const config: AgentConfig = {
        agentId: 'test-agent',
        workspace: '/tmp/test',
        heartbeatInterval: 5000,
      };

      const scheduler = new HeartbeatScheduler([config]);
      scheduler.start();
      scheduler.stop();

      // タイマーがクリアされていることを確認
      // 時間を進めてもハートビートが実行されないことを確認
      vi.advanceTimersByTime(10000);

      expect(mockExecuteHeartbeat).not.toHaveBeenCalled();
    });
  });

  describe('複数エージェントのタイミング', () => {
    it('複数のエージェントが設定された間隔で実行される', async () => {
      const configs: AgentConfig[] = [
        {
          agentId: 'agent-1',
          workspace: '/tmp/agent1',
          heartbeatInterval: 3000, // 3秒
        },
        {
          agentId: 'agent-2',
          workspace: '/tmp/agent2',
          heartbeatInterval: 5000, // 5秒
        },
        {
          agentId: 'agent-3',
          workspace: '/tmp/agent3',
          heartbeatInterval: 7000, // 7秒
        },
      ];

      const executionOrder: string[] = [];
      mockExecuteHeartbeat.mockImplementation(async (agent: any) => {
        executionOrder.push(agent.agentId);
        return {
          success: true,
          shouldNotify: false,
          output: 'HEARTBEAT_OK',
        };
      });

      const scheduler = new HeartbeatScheduler(configs);
      scheduler.start();

      // 初期状態：すべてのエージェントが次回実行待ち
      const initialStates = scheduler.getAgentStates();
      expect(initialStates).toHaveLength(3);

      // 3秒後：agent-1 が実行されるべき
      // 5秒後：agent-2 が実行されるべき
      // 6秒後：agent-1 が再度実行されるべき（3秒 + 3秒）
      // 7秒後：agent-3 が実行されるべき
      await vi.advanceTimersByTimeAsync(3000);
      expect(executionOrder[0]).toBe('agent-1');

      await vi.advanceTimersByTimeAsync(2000);
      expect(executionOrder[1]).toBe('agent-2');

      await vi.advanceTimersByTimeAsync(1000);
      expect(executionOrder[2]).toBe('agent-1');

      await vi.advanceTimersByTimeAsync(1000);
      expect(executionOrder[3]).toBe('agent-3');

      scheduler.stop();
    });

    it('最も早い実行予定のエージェントから順に実行される', async () => {
      const configs: AgentConfig[] = [
        {
          agentId: 'slow-agent',
          workspace: '/tmp/slow',
          heartbeatInterval: 10000, // 10秒
        },
        {
          agentId: 'fast-agent',
          workspace: '/tmp/fast',
          heartbeatInterval: 2000, // 2秒（最速）
        },
        {
          agentId: 'medium-agent',
          workspace: '/tmp/medium',
          heartbeatInterval: 5000, // 5秒
        },
      ];

      const executionOrder: string[] = [];

      mockExecuteHeartbeat.mockImplementation(async (agent: any) => {
        executionOrder.push(agent.agentId);
        return {
          success: true,
          shouldNotify: false,
          output: 'HEARTBEAT_OK',
        };
      });

      const scheduler = new HeartbeatScheduler(configs);
      scheduler.start();

      // 2秒後：fast-agent が最初に実行される
      await vi.advanceTimersByTimeAsync(2000);
      expect(executionOrder[0]).toBe('fast-agent');

      // さらに2秒後（合計4秒）：fast-agent が再度実行される
      await vi.advanceTimersByTimeAsync(2000);
      expect(executionOrder[1]).toBe('fast-agent');

      // さらに1秒後（合計5秒）：medium-agent が実行される
      await vi.advanceTimersByTimeAsync(1000);
      expect(executionOrder[2]).toBe('medium-agent');

      scheduler.stop();
    });
  });

  describe('アクティブ時間帯のチェック', () => {
    it('アクティブ時間外のエージェントは実行されない', async () => {
      // 現在時刻を 12:00 に設定
      vi.setSystemTime(new Date('2024-01-01T12:00:00'));

      const configs: AgentConfig[] = [
        {
          agentId: 'active-agent',
          workspace: '/tmp/active',
          heartbeatInterval: 2000,
          activeHours: {
            start: '08:00',
            end: '18:00', // 現在時刻(12:00)は範囲内
          },
        },
        {
          agentId: 'inactive-agent',
          workspace: '/tmp/inactive',
          heartbeatInterval: 2000,
          activeHours: {
            start: '20:00',
            end: '22:00', // 現在時刻(12:00)は範囲外
          },
        },
      ];

      mockExecuteHeartbeat.mockResolvedValue({
        success: true,
        shouldNotify: false,
        output: 'HEARTBEAT_OK',
      });

      const scheduler = new HeartbeatScheduler(configs);
      scheduler.start();

      // 2秒後
      await vi.advanceTimersByTimeAsync(2000);

      // active-agent は実行されるが、inactive-agent は実行されない
      expect(mockExecuteHeartbeat).toHaveBeenCalledTimes(1);
      expect(mockExecuteHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'active-agent',
        })
      );

      scheduler.stop();
    });

    it('activeHours が未設定の場合は常に実行される', async () => {
      const config: AgentConfig = {
        agentId: 'always-active',
        workspace: '/tmp/always',
        heartbeatInterval: 2000,
        // activeHours: undefined (常に実行)
      };

      mockExecuteHeartbeat.mockResolvedValue({
        success: true,
        shouldNotify: false,
        output: 'HEARTBEAT_OK',
      });

      const scheduler = new HeartbeatScheduler([config]);
      scheduler.start();

      // 2秒後
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockExecuteHeartbeat).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });

  describe('エラーハンドリング', () => {
    it('エージェント実行がエラーでも次回実行はスケジュールされる', async () => {
      const config: AgentConfig = {
        agentId: 'error-agent',
        workspace: '/tmp/error',
        heartbeatInterval: 2000,
      };

      mockExecuteHeartbeat.mockRejectedValueOnce(new Error('Test error'));

      const scheduler = new HeartbeatScheduler([config]);
      scheduler.start();

      // 2秒後：エラーが発生
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockExecuteHeartbeat).toHaveBeenCalledTimes(1);

      // 次回実行が正常に動作することを確認
      mockExecuteHeartbeat.mockResolvedValueOnce({
        success: true,
        shouldNotify: false,
        output: 'HEARTBEAT_OK',
      });

      // さらに2秒後：次回実行が成功
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockExecuteHeartbeat).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });
  });
});
