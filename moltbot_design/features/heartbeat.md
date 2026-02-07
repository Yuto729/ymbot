# Heartbeat 機能

## 概要

Heartbeatは**定期的なエージェントターン**を自動実行し、注意が必要なことをスパムせずに通知する仕組みです。

```
┌────────────────────────────────────────┐
│  Heartbeat = 定期的な「大丈夫？」チェック  │
└────────────────────────────────────────┘

     30分ごと（デフォルト）
          ↓
    ┌──────────┐
    │ Agent    │ "何か注意が必要？"
    │ Turn     │ → HEARTBEAT.md を読む
    └──────────┘ → 複数のチェックをバッチ実行
          ↓
    何もなければ: "HEARTBEAT_OK" → メッセージなし
    注意必要:      アラートを送信
```

## 役割の明確化

### Heartbeatは「監視と通知」

```
Heartbeat ≠ タスクを自動消化する
           ↓
Heartbeat = 「何か注意が必要か？」を定期的にチェック
           → 必要なら通知
           → 必要なければ静かに
```

**実際の動作**:

```
30分ごと
  ↓
HEARTBEAT.mdを読む
  ↓
各項目をチェック
  ↓
┌─────────────────────────────────────┐
│ 緊急メールある？        → なし    │
│ 次2時間の予定ある？     → あり！  │  ← これを検知
│ 期限切れタスクある？    → なし    │
└─────────────────────────────────────┘
  ↓
"明日10時にミーティングがあります"  ← 通知
```

## 基本設定

### 最小限の設定

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",        // 30分ごと（Anthropic OAuth時は 1h）
        target: "last",      // 最後に使った外部チャネルに配信
      }
    }
  }
}
```

### HEARTBEAT.md（チェックリスト）

```md
# Heartbeat checklist

- 未読メールに緊急のものある？
- 次の2時間以内の予定を確認
- 日中なら軽くチェックイン
- タスクがブロックされてたら、何が不足してるか記録
```

**特徴**:
- 小さく保つ（プロンプト肥大化を防ぐ）
- 空か実質的に空（ヘッダーのみ）なら、API呼び出しをスキップ
- エージェントが書き換え可能（明示的指示またはプロンプトで許可）

## Response Contract

### HEARTBEAT_OK プロトコル

```python
# ケース1: 何もない
"HEARTBEAT_OK"
# → メッセージ配信なし、セッションも更新しない

# ケース2: 注意が必要
"緊急: 明日の会議のリマインダー設定されてません"
# → アラートを配信

# ケース3: OKだけど補足
"HEARTBEAT_OK - カレンダーチェック完了、問題なし"
# → 300文字以内なら配信スキップ（ackMaxChars）
```

### 処理ロジック

```python
def process_heartbeat_response(reply: str, ack_max_chars: int = 300) -> tuple[bool, str]:
    """
    Returns: (should_deliver, cleaned_reply)
    """
    # 完全一致
    if reply == "HEARTBEAT_OK":
        return False, ""

    # 先頭に出現
    if reply.startswith("HEARTBEAT_OK "):
        remaining = reply[13:].strip()
        if len(remaining) <= ack_max_chars:
            return False, ""
        return True, remaining

    # 末尾に出現
    if reply.endswith(" HEARTBEAT_OK"):
        remaining = reply[:-13].strip()
        if len(remaining) <= ack_max_chars:
            return False, ""
        return True, remaining

    # 通常のアラート
    return True, reply
```

**重要**:
- `HEARTBEAT_OK` は**先頭か末尾**のみ特別扱い
- 中間に出現したら通常テキスト
- 残りが `ackMaxChars` 以下なら配信スキップ

## デフォルトプロンプト

```
Read HEARTBEAT.md if it exists (workspace context).
Follow it strictly.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.
```

**カスタマイズ可能**:

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        prompt: "Custom prompt here..."  // デフォルトを上書き
      }
    }
  }
}
```

## 高度な設定

### アクティブ時間帯の制限

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        activeHours: {
          start: "08:00",
          end: "22:00"
        }  // 8am-10pm のみ
      }
    }
  }
}
```

**動作**:
- 範囲外では次の範囲内ティックまでスキップ
- タイムゾーンは `agents.defaults.userTimezone` を使用

### パーエージェント設定

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        target: "last"
      }
    },
    list: [
      { id: "main", default: true },  // Heartbeatなし
      {
        id: "ops",
        heartbeat: {
          every: "1h",
          target: "whatsapp",
          to: "+15551234567",
          prompt: "Read HEARTBEAT.md..."
        }
      }
    ]
  }
}
```

**重要**: いずれかの `agents.list[]` に `heartbeat` ブロックがある場合、**それらのエージェントのみ**が Heartbeat を実行します。

### チャネル別の可視性制御

```yaml
channels:
  defaults:
    heartbeat:
      showOk: false      # HEARTBEAT_OK を非表示（デフォルト）
      showAlerts: true   # アラートメッセージを表示（デフォルト）
      useIndicator: true # インジケーターイベントを発信（デフォルト）
  telegram:
    heartbeat:
      showOk: true       # Telegramでは OK も表示
  whatsapp:
    accounts:
      work:
        heartbeat:
          showAlerts: false # このアカウントではアラート抑制
```

**優先順位**: アカウント別 → チャネル別 → チャネルデフォルト → ビルトインデフォルト

### リーズニング配信

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        includeReasoning: true  // 別途 "Reasoning:" メッセージを配信
      }
    }
  }
}
```

**用途**: エージェントの判断プロセスを見たい場合

**注意**: 内部詳細が漏れる可能性あり

## HEARTBEAT.mdの管理

### 静的 vs 動的

| モード | 説明 | 適用場面 |
|--------|------|----------|
| **完全静的** | 手動管理のみ | チェック項目が安定 |
| **明示的更新** | ユーザーが「更新して」と指示 | 時々調整が必要 |
| **自律的更新** | プロンプトで許可 | AIに適応を任せる（実験的） |

### モード1: 完全静的（推奨）

```md
# HEARTBEAT.md（gitで管理）

- Gmail未読チェック（緊急のみ通知）
- カレンダー確認（次2時間の予定）
- TODO.mdチェック（期限切れタスク）
```

**用途**:
- 監視項目が固定
- 予期しない変更を避けたい
- 安定性重視

### モード2: 明示的更新

```bash
User: "HEARTBEAT.mdに天気チェックを追加して"
Agent: [HEARTBEAT.mdを編集]

User: "カレンダーチェックの時間を1時間に変更して"
Agent: [HEARTBEAT.mdを編集]
```

**用途**:
- 時々チェック項目を調整
- ユーザーが変更をコントロール

### モード3: 自律的更新（実験的）

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        prompt: `
          Read HEARTBEAT.md if it exists.
          Follow it strictly.

          If the checklist becomes stale or ineffective,
          update HEARTBEAT.md with a better version.

          If nothing needs attention, reply HEARTBEAT_OK.
        `
      }
    }
  }
}
```

**動作**:
- AIが使用パターンに基づいて最適化
- 不要な項目を削除、新しい項目を追加

**用途**: 実験的な運用、適応型システム

## ユースケース

### ✅ Heartbeatが得意なこと

```md
# HEARTBEAT.md

- Gmail未読チェック（緊急メールある？）
  → 「◯◯さんから緊急メールあり」と通知

- カレンダー確認（次2時間の予定）
  → 「1時間後にミーティング」とリマインド

- タスクリスト確認（期限が今日）
  → 「3件のタスクが今日期限です」と通知

- 天気チェック（雨予報？）
  → 「午後から雨予報、傘を」と通知
```

**特徴**:
- 読み取り中心（状態確認）
- 軽量な処理（30秒以内）
- 通知が主な目的

### ❌ Heartbeatが不向きなこと

```md
# これはダメ ❌

- コードレビューを完了させる
  → 時間がかかる、Heartbeatには不向き

- 週次レポートを生成
  → 重い処理、Cronの isolated session で実行すべき

- バグを修正
  → インタラクティブな作業が必要

- 大量のメールを分類
  → 時間がかかる、ユーザーの明示的な指示が必要
```

## 手動ウェイク

即座にHeartbeatをトリガー：

```bash
# 即座に実行
clawdbot system event \
  --text "緊急フォローアップをチェック" \
  --mode now

# 次のスケジュールティックまで待つ
clawdbot system event \
  --text "プロジェクトステータスを確認" \
  --mode next-heartbeat
```

## コスト最適化

### トークン削減

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        model: "anthropic/claude-haiku-4",  // 安いモデル
        target: "none",  // 内部処理のみ（配信なし）
        ackMaxChars: 100  // OK応答の許容文字数を減らす
      }
    }
  }
}
```

### バッチング

```md
# ❌ 悪い例：5個のCronジョブ
cron: 0 * * * * → メールチェック
cron: 5 * * * * → カレンダーチェック
cron: 10 * * * * → タスクチェック
cron: 15 * * * * → 天気チェック
cron: 20 * * * * → ニュースチェック
→ 5回のAPI呼び出し

# ✅ 良い例：1個のHeartbeat
heartbeat: every 30m
HEARTBEAT.md:
  - メールチェック
  - カレンダーチェック
  - タスクチェック
  - 天気チェック
  - ニュースチェック
→ 1回のAPI呼び出し
```

**効果**: API呼び出し 80%削減

### 空ファイル最適化

```python
def is_effectively_empty(content: str) -> bool:
    """実質的に空かチェック"""
    lines = [
        line.strip()
        for line in content.split('\n')
        if line.strip() and not line.strip().startswith('#')
    ]
    return len(lines) == 0

# 空ならHeartbeat実行をスキップ
if is_effectively_empty(heartbeat_content):
    logger.info("HEARTBEAT.md is empty, skipping API call")
    return
```

## 実装例

```python
from datetime import datetime, time
import pytz
from typing import Optional

class HeartbeatManager:
    def __init__(self, config: dict):
        self.config = config
        self.every = self._parse_duration(config['every'])
        self.active_hours = config.get('activeHours')
        self.ack_max_chars = config.get('ackMaxChars', 300)

    def should_run(self) -> bool:
        """アクティブ時間内かチェック"""
        if not self.active_hours:
            return True

        tz = pytz.timezone(self.config.get('timezone', 'Asia/Tokyo'))
        now = datetime.now(tz).time()
        start = time.fromisoformat(self.active_hours['start'])
        end = time.fromisoformat(self.active_hours['end'])

        return start <= now <= end

    def process_response(self, reply: str) -> tuple[bool, str]:
        """
        Returns: (should_deliver, cleaned_reply)
        """
        if reply == "HEARTBEAT_OK":
            return False, ""

        if reply.startswith("HEARTBEAT_OK "):
            remaining = reply[13:].strip()
            if len(remaining) <= self.ack_max_chars:
                return False, ""
            return True, remaining

        if reply.endswith(" HEARTBEAT_OK"):
            remaining = reply[:-13].strip()
            if len(remaining) <= self.ack_max_chars:
                return False, ""
            return True, remaining

        return True, reply

    def build_prompt(self) -> str:
        """Heartbeatプロンプト構築"""
        return (
            "Read HEARTBEAT.md if it exists (workspace context). "
            "Follow it strictly. "
            "Do not infer or repeat old tasks from prior chats. "
            "If nothing needs attention, reply HEARTBEAT_OK."
        )

    async def run(self, agent):
        """Heartbeat実行"""
        if not self.should_run():
            logger.info("Outside active hours, skipping heartbeat")
            return

        # HEARTBEAT.md読み込み
        heartbeat_md = self._read_heartbeat_md()
        if self._is_effectively_empty(heartbeat_md):
            logger.info("HEARTBEAT.md is empty, skipping API call")
            return

        # エージェントターン実行
        prompt = self.build_prompt()
        reply = await agent.run(prompt, context={"heartbeat": True})

        # 配信判定
        should_deliver, cleaned = self.process_response(reply)

        if should_deliver:
            await self._deliver(cleaned)
        else:
            logger.info("HEARTBEAT_OK received, skipping delivery")

    def _is_effectively_empty(self, content: str) -> bool:
        """実質的に空かチェック"""
        lines = [
            line.strip()
            for line in content.split('\n')
            if line.strip() and not line.strip().startswith('#')
        ]
        return len(lines) == 0
```

## まとめ

```
★ Heartbeatの3つの役割
  1. 監視 → 定期的に状態をチェック
  2. バッチング → 複数のチェックを1回のターンで実行
  3. スマート通知 → 必要な時だけアラート、不要ならHEARTBEAT_OK
```

**メリット**:
- ✅ API呼び出し 80%以上削減（バッチング効果）
- ✅ ユーザー体験向上（スパムなし）
- ✅ コンテキスト維持（メインセッションで実行）

## 実装詳細

### スケジューリングアーキテクチャ

**2層構造**:

```
1. heartbeat-runner.ts (時刻管理層)
   - いつ実行するか（30分ごと等）
   - setTimeout ベース（setInterval ではない）
   - マルチエージェントの統合管理

2. heartbeat-wake.ts (実行制御層)
   - どう実行するか（統合・保護・リトライ）
   - Coalesce パターン
   - 実行中の保護
```

### scheduleNext() - 時刻管理

```typescript
// heartbeat-runner.ts:787-805
const scheduleNext = () => {
  // 全エージェントの最も早い実行時刻を計算
  let nextDue = Number.POSITIVE_INFINITY;
  for (const agent of state.agents.values()) {
    if (agent.nextDueMs < nextDue) nextDue = agent.nextDueMs;
  }

  // 次回実行時刻でsetTimeout（setIntervalではない）
  const delay = Math.max(0, nextDue - Date.now());
  state.timer = setTimeout(() => {
    requestHeartbeatNow({ reason: "interval" });
  }, delay);

  state.timer.unref?.();  // プロセス終了をブロックしない
};
```

**なぜsetTimeoutか**:
- 実行時間を考慮して次回を計算（ドリフト防止）
- 設定変更時に即座に再スケジュール
- 複数エージェントを1タイマーで統合

### 実行判定 - エージェント別

```typescript
// heartbeat-runner.ts:864-886
const run = async (params) => {
  const now = Date.now();

  for (const agent of state.agents.values()) {
    // まだ実行時刻じゃないエージェントはスキップ
    if (isInterval && now < agent.nextDueMs) {
      continue;
    }

    // 実行
    await runHeartbeatOnce({ agentId: agent.agentId });

    // 次回実行時刻を更新
    agent.nextDueMs = now + agent.intervalMs;
  }

  scheduleNext();  // 次のタイマーセット
};
```

**効率的なマルチタイマー実装**:
- タイマーは1個だけ（最も早い時刻）
- 発火時に全エージェントをチェック
- 時刻が来ているものだけ実行

### Coalesce パターン - リクエスト統合

```typescript
// heartbeat-wake.ts:17-50
let timer: NodeJS.Timeout | null = null;
let pendingReason: string | null = null;

function schedule(coalesceMs: number) {
  if (timer) return;  // ★ タイマー二重防止

  timer = setTimeout(async () => {
    timer = null;
    const reason = pendingReason;
    pendingReason = null;

    await handler({ reason });
  }, coalesceMs);  // デフォルト250ms
}

export function requestHeartbeatNow(opts) {
  pendingReason = opts?.reason ?? "requested";
  schedule(opts?.coalesceMs ?? 250);
}
```

**動作**:

```
時刻 0ms:   requestHeartbeatNow({ reason: "event1" })
            → タイマーセット（250ms後）

時刻 50ms:  requestHeartbeatNow({ reason: "event2" })
            → タイマー既にあり、何もしない

時刻 100ms: requestHeartbeatNow({ reason: "event3" })
            → タイマー既にあり、何もしない

時刻 250ms: タイマー発火
            → 1回だけ実行（3回ではない）
```

**パターン比較**:

| パターン | タイミング | 用途 |
|---------|----------|------|
| Debounce | 最後から N ms 後 | 検索入力 |
| Throttle | N ms ごと | スクロール |
| **Coalesce** | 最初から N ms 後 | **イベント統合** |

Moltbotは即応性とバッチ効率のバランスで Coalesce を採用。

### マルチエージェント設計

**各エージェントは独立したワークスペース**:

```
~/.clawdbot/agents/
├── personal/
│   ├── HEARTBEAT.md     ← personalエージェント用
│   ├── SOUL.md
│   └── IDENTITY.md
├── work/
│   ├── HEARTBEAT.md     ← workエージェント用
│   ├── SOUL.md
│   └── IDENTITY.md
└── critical/
    └── HEARTBEAT.md     ← criticalエージェント用
```

**設定例**:

```json5
{
  agents: {
    list: [
      {
        id: "personal",
        workspace: "~/.clawdbot/agents/personal",
        heartbeat: { every: "30m", target: "whatsapp" }
      },
      {
        id: "work",
        workspace: "~/.clawdbot/agents/work",
        heartbeat: { every: "1h", target: "slack" }
      },
      {
        id: "critical",
        workspace: "~/.clawdbot/agents/critical",
        heartbeat: { every: "5m", target: "slack" }
      }
    ]
  }
}
```

**メリット**:
- 関心の分離（個人/仕事/監視）
- 頻度の最適化（重要度に応じて）
- 配信の分離（WhatsApp/Slack等）
- スケーラビリティ（プロジェクト追加時に新エージェント追加）

### 起動シーケンス

```
1. CLI実行
   $ clawdbot gateway
     ↓
2. Gateway起動
   startGatewayServer()
     ↓
3. 設定読み込み
   cfgAtStart = loadConfig()
     ↓
4. Heartbeat起動
   heartbeatRunner = startHeartbeatRunner({ cfg: cfgAtStart })
     - 各エージェントのHeartbeat設定を読む
     - 最も早い実行時刻を計算
     - setTimeout をセット
     ↓
5. Cron起動
   cron.start()
     ↓
6. WebSocketサーバー起動
   attachGatewayWsHandlers(...)
     ↓
7. Gateway稼働中
```

**永続性の保証**:

```
systemd/launchd (OS監視)
    ↓ プロセス監視
Gateway プロセス
    ├─ setTimeout (Heartbeat) ← 揮発性
    └─ WebSocket サーバー

プロセスが落ちたら:
  → systemd/launchdが再起動
  → Heartbeatも再初期化
```

### 設定リロード

```typescript
// Config変更時
heartbeatRunner.updateConfig(newConfig);
  ↓
1. 既存のタイマーをクリア
2. 新しい設定で再計算
3. 新しいsetTimeoutをセット
```

**再起動不要** - 設定変更を動的に反映。

## 次のステップ

- [Cron vs Heartbeat](./cron-vs-heartbeat.md) - スケジューリング戦略の選択
- [raspi_todo_appへの適用](../raspi-application.md) - 実際の適用方法
