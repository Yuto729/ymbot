# Claude Agent SDK を使った自律駆動型エージェントの実装

## 概要

このドキュメントでは、Claude Agent SDK を使って自律的に動作するエージェントシステムを TypeScript で実装する方法を説明します。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│              自律型エージェントシステム                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌────────────────┐      ┌──────────────────────┐     │
│  │   Heartbeat    │─────>│  Claude Agent SDK    │     │
│  │   スケジューラ  │      │   query() 関数       │     │
│  │  (setTimeout)  │      └──────────────────────┘     │
│  └────────────────┘                │                   │
│         │                           │                   │
│         │                           v                   │
│         │              ┌─────────────────────────┐     │
│         │              │  組み込みツール          │     │
│         │              │  - Read, Write, Edit    │     │
│         └──────────────│  - Bash, Glob, Grep     │     │
│                        │  - WebSearch            │     │
│                        │  - Skill (filesystem)   │     │
│                        └─────────────────────────┘     │
│                                    │                    │
│                                    v                    │
│                        ┌─────────────────────────┐     │
│                        │  Skills (filesystem)    │     │
│                        │  .claude/skills/        │     │
│                        │  ~/.claude/skills/      │     │
│                        └─────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## 設計原則

### 1. Claude Agent SDK に委譲
- **エンジン**: `@anthropic-ai/claude-agent-sdk` の `query()` 関数を使用
- **ツール**: 組み込みツール（Read, Write, Edit, Bash, Glob, Grep, WebSearch, Skill）
- **スキル**: ファイルシステムベース（`.claude/skills/` + `~/.claude/skills/`）
- **セッション**: SDK が `resume` オプションでセッション永続化を管理

### 2. カスタムコードを最小限に
- **スケジューラ**: heartbeat のタイミング制御のみ実装（setTimeout）
- **設定**: `HEARTBEAT.md` とエージェント設定の読み込み
- **再実装なし**: すべてのエージェント機能は SDK に任せる

### 3. Skills サポート
- **ファイルシステムベース**: `SKILL.md` ファイルとして定義
- **自動発見**: 起動時に SDK がスキルを発見（メタデータのみ）
- **遅延読み込み**: Claude がスキルを呼び出す時にフルコンテンツを読み込み
- **必須設定**:
  - `settingSources: ["user", "project"]`
  - `"Skill"` を `allowedTools` に追加

## TypeScript 実装

### 依存関係

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

### コア実装

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface AgentConfig {
  agentId: string;
  workspace: string;
  heartbeatInterval: number; // ミリ秒
  activeHours?: { start: string; end: string };
}

interface AgentState {
  agentId: string;
  config: AgentConfig;
  nextDueMs: number;
  intervalMs: number;
  sessionId?: string;
}

class AutonomousAgent {
  private agents = new Map<string, AgentState>();
  private timer?: NodeJS.Timeout;

  constructor(private configs: AgentConfig[]) {
    const now = Date.now();
    for (const config of configs) {
      this.agents.set(config.agentId, {
        agentId: config.agentId,
        config,
        nextDueMs: now + config.heartbeatInterval,
        intervalMs: config.heartbeatInterval,
      });
    }
  }

  /**
   * 自律エージェントシステムを開始
   */
  start() {
    console.log('自律エージェントシステムを開始...');
    this.scheduleNext();
  }

  /**
   * 自律エージェントシステムを停止
   */
  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    console.log('自律エージェントシステムを停止しました');
  }

  /**
   * 次の heartbeat 実行をスケジュール
   * 正確なタイミング制御のため setInterval ではなく setTimeout を使用
   */
  private scheduleNext() {
    // 最も早い実行予定のエージェントを見つける
    let nextDueMs = Number.POSITIVE_INFINITY;
    for (const agent of this.agents.values()) {
      if (agent.nextDueMs < nextDueMs) {
        nextDueMs = agent.nextDueMs;
      }
    }

    const delay = Math.max(0, nextDueMs - Date.now());

    this.timer = setTimeout(async () => {
      await this.executeHeartbeats();
      this.scheduleNext(); // 実行後に再スケジュール
    }, delay);

    // このタイマーだけが残っている場合はプロセス終了を許可
    this.timer.unref?.();

    console.log(`次の heartbeat は ${Math.round(delay / 1000)}秒後`);
  }

  /**
   * 実行予定のすべてのエージェントの heartbeat を実行
   */
  private async executeHeartbeats() {
    const now = Date.now();

    for (const agent of this.agents.values()) {
      // まだ実行時刻に達していなければスキップ
      if (now < agent.nextDueMs) {
        continue;
      }

      // アクティブ時間帯をチェック
      if (!this.isWithinActiveHours(agent.config)) {
        agent.nextDueMs = now + agent.intervalMs;
        continue;
      }

      try {
        console.log(`[${agent.agentId}] heartbeat 実行中...`);
        await this.runHeartbeat(agent);

        // 次回実行をスケジュール
        agent.nextDueMs = now + agent.intervalMs;
        console.log(`[${agent.agentId}] heartbeat 完了`);
      } catch (error) {
        console.error(`[${agent.agentId}] heartbeat 失敗:`, error);
        // エラーが発生しても次回実行をスケジュール
        agent.nextDueMs = now + agent.intervalMs;
      }
    }
  }

  /**
   * Claude Agent SDK を使って単一エージェントの heartbeat を実行
   */
  private async runHeartbeat(agent: AgentState) {
    const { workspace } = agent.config;

    // HEARTBEAT.md が存在すれば読み込み
    let heartbeatPrompt = '注意が必要な通知や更新がないか確認してください。';
    try {
      const heartbeatPath = join(workspace, 'HEARTBEAT.md');
      const content = await readFile(heartbeatPath, 'utf-8');
      heartbeatPrompt = `HEARTBEAT.md を読み込んでリストされているチェックを実行:\n\n${content}`;
    } catch {
      // HEARTBEAT.md が存在しない場合はデフォルトプロンプトを使用
    }

    // ユーザーに通知すべきかを追跡
    let shouldNotify = false;
    let output = '';

    // Claude Agent SDK を使って heartbeat を実行
    for await (const message of query({
      prompt: heartbeatPrompt,
      options: {
        // 作業ディレクトリ（.claude/skills/ がある場所）
        cwd: workspace,

        // ファイルシステムから Skills を読み込み
        settingSources: ['user', 'project'],

        // ツール + Skills を有効化
        allowedTools: [
          'Read',      // ファイル読み込み
          'Bash',      // コマンド実行
          'Glob',      // ファイル検索
          'Grep',      // ファイル内検索
          'Skill',     // Skills を有効化（.claude/skills/）
        ],

        // セッション管理（前回のセッションを再開）
        resume: agent.sessionId,

        // 権限モード
        permissionMode: 'acceptEdits',

        // フック（オプションのログ記録）
        hooks: {
          PostToolUse: [{
            hooks: [(event) => {
              console.log(`[${agent.agentId}] ツール使用: ${event.tool.name}`);
            }]
          }]
        }
      }
    })) {
      // メッセージを処理
      if (message.type === 'text') {
        output += message.text;

        // HEARTBEAT_OK プロトコルをチェック
        if (message.text.includes('HEARTBEAT_OK')) {
          console.log(`[${agent.agentId}] HEARTBEAT_OK - 通知不要`);
          shouldNotify = false;
        } else {
          shouldNotify = true;
        }
      } else if (message.type === 'session_id') {
        // 次回の heartbeat のためにセッション ID を保存
        agent.sessionId = message.sessionId;
      }
    }

    // 必要に応じてユーザーに通知
    if (shouldNotify && output) {
      await this.notify(agent.agentId, output);
    }
  }

  /**
   * 現在時刻がアクティブ時間帯内かチェック
   */
  private isWithinActiveHours(config: AgentConfig): boolean {
    if (!config.activeHours) {
      return true; // 制限なし
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = config.activeHours.start.split(':').map(Number);
    const [endHour, endMinute] = config.activeHours.end.split(':').map(Number);

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * ユーザーに通知（通知ロジックをここに実装）
   */
  private async notify(agentId: string, message: string) {
    console.log(`[${agentId}] 通知:\n${message}`);
    // TODO: 通知配信を実装（WhatsApp、Telegram など）
  }
}

// 使用例
const agent = new AutonomousAgent([
  {
    agentId: 'personal',
    workspace: '/home/user/workspace',
    heartbeatInterval: 30 * 60 * 1000, // 30分
    activeHours: { start: '08:00', end: '22:00' }
  }
]);

agent.start();

// グレースフルシャットダウン
process.on('SIGINT', () => {
  agent.stop();
  process.exit(0);
});
```

## Skills ディレクトリ構造

```
/home/user/workspace/
├── .claude/
│   └── skills/           # プロジェクト固有のスキル
│       ├── gmail/
│       │   └── SKILL.md
│       ├── calendar/
│       │   └── SKILL.md
│       └── tasks/
│           └── SKILL.md
├── HEARTBEAT.md          # Heartbeat チェックリスト
└── ...

~/.claude/
└── skills/               # ユーザー共通のスキル
    ├── gemini-search/
    │   └── SKILL.md
    └── learning-journal/
        └── SKILL.md
```

## HEARTBEAT.md の例

```markdown
# Heartbeat チェックリスト

以下のチェックを実行し、注意が必要なものがある場合のみ通知してください：

1. **Gmail**: 「urgent」ラベルまたは VIP からの未読メールをチェック
   - gmail スキルを使って未読メールをチェック
   - 緊急メールがある場合のみ通知

2. **Calendar**: 今後2時間以内のイベントをチェック
   - calendar スキルを使って今後のイベントをチェック
   - まもなく開始されるイベントがある場合のみ通知

3. **Tasks**: 今日が期限または期限切れのタスクをチェック
   - tasks スキルを使ってタスクリストをチェック
   - 期限が来ている/過ぎているタスクがある場合のみ通知

4. **長時間アイドル**: 8時間以上やりとりがない場合は挨拶
   - 最後のやりとりのタイムスタンプをチェック
   - アイドル時間が長すぎる場合は軽くチェックイン

**重要**: すべてのチェックが問題なしの場合、`HEARTBEAT_OK` とだけ返答してください。
```

## Skills の例

### Gmail スキル (`.claude/skills/gmail/SKILL.md`)

```markdown
---
name: gmail
description: gog CLI を使って Gmail メッセージを検索・読み取り
version: 1.0.0
requires:
  - gog-cli (pip install gog-cli)
---

# Gmail スキル

## 説明
gog CLI を使って Gmail メッセージを検索・読み取ります。

## 使い方

### 未読メールをチェック
\`\`\`bash
gog gmail list --unread --max-results 10
\`\`\`

### 緊急メールを検索
\`\`\`bash
gog gmail list --query "is:unread label:urgent" --max-results 5
\`\`\`

### ID でメールを読む
\`\`\`bash
gog gmail read <message-id>
\`\`\`

## エラーハンドリング

認証に失敗した場合:
1. `gog auth` を実行して再認証
2. OAuth フローに従う
```

### Calendar スキル (`.claude/skills/calendar/SKILL.md`)

```markdown
---
name: calendar
description: gog CLI を使って Google Calendar のイベントをチェック
version: 1.0.0
requires:
  - gog-cli (pip install gog-cli)
---

# Calendar スキル

## 説明
gog CLI を使って Google Calendar の今後のイベントをチェックします。

## 使い方

### 今後2時間のイベントをチェック
\`\`\`bash
gog calendar list --time-min now --time-max 2h --max-results 5
\`\`\`

### 今日のイベントをチェック
\`\`\`bash
gog calendar list --time-min today --time-max tomorrow --max-results 10
\`\`\`

## エラーハンドリング

認証に失敗した場合:
1. `gog auth` を実行して再認証
2. OAuth フローに従う
```

## 設定ファイル

```json
{
  "agents": [
    {
      "agentId": "personal",
      "workspace": "/home/user/workspace",
      "heartbeatInterval": 1800000,
      "activeHours": {
        "start": "08:00",
        "end": "22:00"
      }
    }
  ]
}
```

## systemd でのデプロイ

`/etc/systemd/system/autonomous-agent.service` を作成:

```ini
[Unit]
Description=Autonomous Agent with Claude SDK
After=network.target

[Service]
Type=simple
User=user
WorkingDirectory=/home/user/autonomous-agent
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

有効化して起動:

```bash
sudo systemctl enable autonomous-agent
sudo systemctl start autonomous-agent
sudo systemctl status autonomous-agent
```

## Skills の動作

### 1. 発見フェーズ（起動時）

```
エージェント起動
    │
    ├─> settingSources: ["user", "project"]
    │
    ├─> ~/.claude/skills/ をスキャン
    │   └─> SKILL.md frontmatter からメタデータを抽出
    │       (name, description, version, requires)
    │
    ├─> .claude/skills/ をスキャン
    │   └─> SKILL.md frontmatter からメタデータを抽出
    │
    └─> Claude がスキルメタデータを利用可能に
        （フルコンテンツではなく、name + description のみ）
```

### 2. 実行フェーズ（Heartbeat）

```
Heartbeat トリガー
    │
    ├─> Claude がプロンプト + 利用可能なスキルメタデータを受け取る
    │
    ├─> Claude が判断: 「Gmail をチェックする必要がある」
    │
    ├─> Claude が Skill ツールを呼び出し: skill="gmail"
    │
    ├─> SDK が SKILL.md のフルコンテンツを読み込み
    │   └─> ~/.claude/skills/gmail/SKILL.md
    │
    ├─> Claude がスキルの指示を読む
    │
    ├─> Claude が実行: gog gmail list --unread
    │   └─> Bash ツールを使用
    │
    └─> 結果が Claude に返される
```

### 3. 主な違い: Skills vs ツール

| 観点 | Skills | ツール |
|------|--------|-------|
| **定義** | ファイルシステムアーティファクト（`SKILL.md`） | プログラマティックまたは組み込み |
| **読み込み** | 遅延（起動時はメタデータ、オンデマンドでコンテンツ） | 即座（すぐに利用可能） |
| **発見** | ファイルシステムから自動 | 明示的な設定 |
| **呼び出し** | Claude が description に基づいて判断 | Claude が適切な時に使用 |
| **場所** | `.claude/skills/`, `~/.claude/skills/` | SDK 組み込み |
| **コンテンツ** | 指示付きマークダウン | コード（関数） |

## 自律エージェントにおける Skills の利点

### 1. 関心の分離
- **エージェントコード**: 最小限、スケジューリングロジックのみ
- **エージェント機能**: Skills（ファイルシステム）で定義
- **簡単な更新**: コード変更なしで `SKILL.md` を編集

### 2. オンデマンド読み込み
- **プロンプトにはメタデータのみ**: name + description（約50トークン）
- **必要時にフルコンテンツ読み込み**: 完全な指示（約2000トークン）
- **プロンプトはコンパクト**: 数百のスキルにスケール可能

### 3. ユーザー + プロジェクト Skills
- **ユーザースキル**（`~/.claude/skills/`）: すべてのエージェントで利用可能
- **プロジェクトスキル**（`.claude/skills/`）: ワークスペース固有
- **コード変更不要**: `SKILL.md` ファイルを作成するだけ

### 4. バージョン管理フレンドリー
- Skills はマークダウンファイル
- git にコミット可能
- チームメンバーが同じスキルを共有

### 5. Claude が使用タイミングを判断
- 「gmail スキルを使え」と指定する必要なし
- Claude がスキルの description を読んで判断
- ハードコードされたツール選択より賢い

## トークン経済性

### Skills なし（すべての指示をプロンプトに含める）

```
システムプロンプト:
  - Gmail 指示: 2,000 トークン
  - Calendar 指示: 1,500 トークン
  - Tasks 指示: 1,800 トークン
  - Weather 指示: 1,200 トークン
  - News 指示: 1,000 トークン
  ─────────────────────────────────
  合計: 7,500 トークン

毎回の heartbeat: 7,500 トークン
1日48回の heartbeat: 360,000 トークン/日
```

### Skills あり（メタデータのみ + オンデマンド）

```
システムプロンプト:
  - スキルメタデータ（5スキル × 50トークン）: 250 トークン
  ─────────────────────────────────
  合計: 250 トークン

典型的な heartbeat:
  - プロンプト: 250 トークン
  - 1-2 スキル読み込み: 約3,000 トークン
  - 合計: 約3,250 トークン

1日48回の heartbeat: 156,000 トークン/日
削減率: 57%
```

## 高度な設定

### 異なる Skills を持つ複数エージェント

```typescript
const agent = new AutonomousAgent([
  {
    agentId: 'personal',
    workspace: '/home/user/personal',
    heartbeatInterval: 30 * 60 * 1000,
    activeHours: { start: '08:00', end: '22:00' }
  },
  {
    agentId: 'work',
    workspace: '/home/user/work',
    heartbeatInterval: 60 * 60 * 1000,
    activeHours: { start: '09:00', end: '18:00' }
  }
]);
```

各ワークスペースは異なる `.claude/skills/` ディレクトリを持てます。

### カスタムツール制限

```typescript
allowedTools: [
  'Read',      // 常に許可
  'Bash',      // コマンド実行を許可
  'Skill',     // Skills を有効化
  // 'Edit',   // 無効 - 読み取り専用 heartbeat
  // 'Write',  // 無効 - 読み取り専用 heartbeat
]
```

## トラブルシューティング

### Skills が見つからない

```bash
# SKILL.md が存在するかチェック
ls .claude/skills/*/SKILL.md
ls ~/.claude/skills/*/SKILL.md

# settingSources 設定をチェック
# 必須: settingSources: ["user", "project"]
```

### Skill が使われない

1. SKILL.md frontmatter の description をチェック
2. 関連するキーワードが含まれているか確認
3. Claude に直接聞いてテスト: 「利用可能なスキルは何？」

### 認証エラー（gog CLI）

```bash
# 再認証
gog auth

# スキルを手動でテスト
gog gmail list --max-results 1
```

## 次のステップ

1. **Skills ディレクトリの設定**: ワークスペースに `.claude/skills/` を作成
2. **Skills の作成**: 機能に対して `SKILL.md` ファイルを書く
3. **Skills のテスト**: Claude に利用可能なスキルをリストアップしてもらう
4. **エージェントの設定**: heartbeat 間隔とアクティブ時間を設定
5. **デプロイ**: 本番環境では systemd を使用

## 参考資料

- [Claude Agent SDK Skills ドキュメント](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Agent Skills ベストプラクティス](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Claude Code Skills ガイド](https://code.claude.com/docs/en/skills)
