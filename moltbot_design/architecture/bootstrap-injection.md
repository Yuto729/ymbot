# ブートストラップファイル注入

## 概要

Moltbotは起動時に特定のファイル（ブートストラップファイル）を自動的にシステムプロンプトに注入します。これにより、エージェントは明示的な`read`呼び出しなしにコンテキストを取得できます。

## 自動注入されるファイル

```
AGENTS.md      - 操作ルール・振る舞いガイドライン
SOUL.md        - コア価値観・ペルソナ
TOOLS.md       - ツール定義・使い方
IDENTITY.md    - アイデンティティ・役割
USER.md        - ユーザーコンテキスト・プロフィール
HEARTBEAT.md   - ハートビートチェックリスト
BOOTSTRAP.md   - 新規ワークスペースのみ（初回セットアップ用）
```

## なぜ自動注入するのか

### 問題：毎回 read を呼ぶのは非効率

**ナイーブな実装**:

```
User: "メール確認して"
  ↓
Agent: [read IDENTITY.md]
Agent: [read SOUL.md]
Agent: [read AGENTS.md]
Agent: [Gmail検索実行]
Agent: "未読メールはありません"

→ 3回の追加ツール呼び出し！
→ レイテンシ増加
```

### 解決策：自動注入

```
User: "メール確認して"
  ↓
System Prompt:
  - IDENTITY.md（既に注入済み）
  - SOUL.md（既に注入済み）
  - AGENTS.md（既に注入済み）
  ↓
Agent: [Gmail検索実行]
Agent: "未読メールはありません"

→ ツール呼び出し1回のみ
→ レイテンシ削減
```

## 注入の仕組み

### 1. ファイル読み込み

```python
def inject_bootstrap_files(workspace: Path, max_chars: int = 20000) -> str:
    """ブートストラップファイルを読み込んで注入"""
    files = [
        "AGENTS.md",
        "SOUL.md",
        "TOOLS.md",
        "IDENTITY.md",
        "USER.md",
        "HEARTBEAT.md"
    ]

    content = "# Project Context\n\n"

    for filename in files:
        filepath = workspace / filename

        if filepath.exists():
            file_content = filepath.read_text()

            # トリミング（max_chars制限）
            if len(file_content) > max_chars:
                file_content = file_content[:max_chars]
                file_content += "\n\n[... truncated ...]\n"

            content += f"## {filename}\n\n{file_content}\n\n"
        else:
            # 欠けているファイルにはマーカー
            content += f"## {filename}\n\n[File not found]\n\n"

    return content
```

### 2. システムプロンプトへの組み込み

```python
def build_system_prompt(workspace: Path, config: dict) -> str:
    sections = []

    # 固定セクション
    sections.append(format_tooling())
    sections.append(format_skills())
    sections.append(format_workspace())

    # ブートストラップファイル注入
    sections.append(inject_bootstrap_files(workspace, config['bootstrapMaxChars']))

    # その他のセクション
    sections.append(format_runtime())

    return "\n\n".join(sections)
```

## ファイルサイズ制限

### デフォルト：20,000文字

**理由**:
- プロンプトサイズを管理可能に保つ
- 大きすぎるファイルでトークンを消費しない
- ほとんどのユースケースで十分

**設定**:

```json5
{
  agents: {
    defaults: {
      bootstrapMaxChars: 20000  // デフォルト
    }
  }
}
```

### トリミング動作

```python
# ファイルが大きすぎる場合
if len(content) > max_chars:
    content = content[:max_chars]
    content += "\n\n[... truncated ...]\n"
```

**表示例**:

```md
## SOUL.md

I am a helpful AI assistant focused on...
[... 19,950文字 ...]
... and always prioritize user privacy.

[... truncated ...]
```

### コンテキスト確認

注入されたファイルのサイズを確認：

```bash
clawdbot context list    # 概要表示
clawdbot context detail  # 詳細表示
```

出力例：

```
Bootstrap files injection:
- SOUL.md: 1,234 chars (raw: 1,234)
- IDENTITY.md: 567 chars (raw: 567)
- AGENTS.md: 3,456 chars (raw: 3,456)
- USER.md: 890 chars (raw: 890)
- HEARTBEAT.md: 234 chars (raw: 234)
- TOOLS.md: [not found]

Total bootstrap: 6,381 chars
Tool schemas: ~2,000 chars
Total prompt size: ~8,500 chars
```

## フック機構

### agent:bootstrap フック

カスタマイズが必要な場合、フックで注入内容を変更できます。

```typescript
// 例：SOUL.mdを別のペルソナに差し替え
registerInternalHook("agent:bootstrap", async (context) => {
  // ワークモードに応じて異なるSOUL.mdを使用
  if (context.mode === "work") {
    context.bootstrap.SOUL = await readFile("~/personas/professional.md");
  } else if (context.mode === "casual") {
    context.bootstrap.SOUL = await readFile("~/personas/friendly.md");
  }

  return context;
});
```

**ユースケース**:
- 時間帯に応じたペルソナ変更
- ユーザーグループごとの設定
- A/Bテスト
- 開発環境と本番環境での差異

## ファイル別の役割

### SOUL.md（コア価値観）

```md
# Soul

I am a helpful AI assistant who:
- Prioritizes user privacy and security
- Provides concise, actionable responses
- Admits when I don't know something
- Never hallucinates information

Core values:
- Honesty
- Clarity
- Efficiency
```

**用途**: エージェントの基本的な価値観とペルソナ

### IDENTITY.md（アイデンティティ）

```md
# Identity

Name: TodoBot
Role: Personal productivity assistant
Specialization: Email, calendar, and task management

Communication style:
- Friendly but professional
- Brief summaries preferred
- Use emojis sparingly
```

**用途**: エージェントの名前、役割、コミュニケーションスタイル

### AGENTS.md（操作ルール）

```md
# Agent Guidelines

## Email Handling
- Only read emails marked as "urgent"
- Summarize long emails (>500 words)
- Never send emails without explicit user approval

## Calendar Management
- Remind 2 hours before events
- Check for conflicts when adding events

## Task Management
- Mark tasks as complete only when explicitly told
- Prioritize tasks by due date
```

**用途**: 具体的な操作ルールとガイドライン

### USER.md（ユーザーコンテキスト）

```md
# User Context

Name: Mitomi
Timezone: Asia/Tokyo
Work hours: 09:00 - 18:00

Preferences:
- Prefers morning reminders
- Dislikes notifications during lunch (12:00-13:00)
- Uses Pomodoro technique (25min work, 5min break)

Current projects:
- raspi_todo_app (priority: high)
- blog_writing (priority: medium)
```

**用途**: ユーザーのプロファイルと好み

### HEARTBEAT.md（チェックリスト）

```md
# Heartbeat Checklist

- Check Gmail for urgent emails
- Review calendar for next 2 hours
- Check Google Tasks for today's due items
- Light check-in if idle for 8+ hours
```

**用途**: 定期チェック項目（詳細は[Heartbeat機能](../features/heartbeat.md)参照）

### TOOLS.md（ツール定義）

```md
# Tools

## Gmail Skill
Command: /check-mail
Usage: Check emails with filters
Example: /check-mail --unread --urgent

## Calendar Skill
Command: /check-calendar
Usage: Check calendar events
Example: /check-calendar --next 2h
```

**用途**: カスタムツール・スキルの使い方

## 欠けているファイルの扱い

### マーカー注入

ファイルが存在しない場合、マーカーを注入：

```md
## TOOLS.md

[File not found]
```

**理由**:
- エージェントがファイルの不在を認識できる
- 「読み込めなかった」のか「存在しない」のかが明確
- デバッグが容易

### 空ファイルの最適化

**HEARTBEAT.md特別扱い**:

実質的に空（ヘッダーと空行のみ）の場合、Heartbeat実行をスキップ：

```python
def is_effectively_empty(content: str) -> bool:
    """実質的に空かチェック"""
    lines = [
        line.strip()
        for line in content.split('\n')
        if line.strip() and not line.strip().startswith('#')
    ]
    return len(lines) == 0

# 空ならHeartbeat実行をスキップ → API呼び出し節約
if is_effectively_empty(heartbeat_content):
    logger.info("HEARTBEAT.md is empty, skipping API call")
    return
```

## 実装パターン

### パターン1: シンプル実装

```python
class BootstrapInjector:
    def __init__(self, workspace: Path, max_chars: int = 20000):
        self.workspace = workspace
        self.max_chars = max_chars
        self.files = [
            "AGENTS.md",
            "SOUL.md",
            "TOOLS.md",
            "IDENTITY.md",
            "USER.md",
            "HEARTBEAT.md"
        ]

    def inject(self) -> str:
        """ブートストラップファイルを注入"""
        content = "# Project Context\n\n"

        for filename in self.files:
            content += self._read_file(filename)

        return content

    def _read_file(self, filename: str) -> str:
        filepath = self.workspace / filename

        if not filepath.exists():
            return f"## {filename}\n\n[File not found]\n\n"

        file_content = filepath.read_text()

        # トリミング
        if len(file_content) > self.max_chars:
            file_content = file_content[:self.max_chars] + "\n\n[... truncated ...]\n"

        return f"## {filename}\n\n{file_content}\n\n"
```

### パターン2: キャッシュ付き

```python
class CachedBootstrapInjector:
    def __init__(self, workspace: Path, max_chars: int = 20000):
        self.workspace = workspace
        self.max_chars = max_chars
        self._cache = {}
        self._mtimes = {}

    def inject(self) -> str:
        """キャッシュを使ってブートストラップファイルを注入"""
        content = "# Project Context\n\n"

        for filename in self.files:
            content += self._read_file_cached(filename)

        return content

    def _read_file_cached(self, filename: str) -> str:
        filepath = self.workspace / filename

        if not filepath.exists():
            return f"## {filename}\n\n[File not found]\n\n"

        # mtime チェック
        mtime = filepath.stat().st_mtime

        if filename in self._cache and self._mtimes.get(filename) == mtime:
            # キャッシュヒット
            return self._cache[filename]

        # ファイル読み込み
        file_content = filepath.read_text()

        # トリミング
        if len(file_content) > self.max_chars:
            file_content = file_content[:self.max_chars] + "\n\n[... truncated ...]\n"

        result = f"## {filename}\n\n{file_content}\n\n"

        # キャッシュ更新
        self._cache[filename] = result
        self._mtimes[filename] = mtime

        return result
```

## ベストプラクティス

### 1. 各ファイルを小さく保つ

```
✅ 良い例:
SOUL.md:         500文字
IDENTITY.md:     300文字
AGENTS.md:     2,000文字
USER.md:         400文字
HEARTBEAT.md:    200文字
───────────────────────
合計:          3,400文字

❌ 悪い例:
SOUL.md:      15,000文字  # 大きすぎる！
IDENTITY.md:  10,000文字  # 大きすぎる！
```

### 2. 重複を避ける

```md
❌ 悪い例:

# SOUL.md
I prioritize user privacy...

# IDENTITY.md
I prioritize user privacy...  # 重複

# AGENTS.md
Always prioritize user privacy...  # さらに重複
```

```md
✅ 良い例:

# SOUL.md
Core values:
- User privacy
- Honesty
- Efficiency

# IDENTITY.md
Name: TodoBot
Role: Personal assistant

# AGENTS.md
When handling emails:
- Follow privacy guidelines from SOUL.md
```

### 3. 構造化する

```md
✅ 良い例（AGENTS.md）:

# Agent Guidelines

## Email Handling
- Rule 1
- Rule 2

## Calendar Management
- Rule 1
- Rule 2

## Task Management
- Rule 1
- Rule 2
```

## まとめ

```
★ ブートストラップ注入の3つのメリット
  1. レイテンシ削減 → 毎回readを呼ばなくて良い
  2. コンテキスト保証 → 必要な情報が常に利用可能
  3. 設定の一元管理 → ファイルで管理、gitで履歴追跡
```

**効果**:
- ✅ 初回ツール呼び出し 50%以上削減
- ✅ レイテンシ 30%削減
- ✅ コンテキスト一貫性の向上

## 次のステップ

- [システムプロンプト設計](./system-prompt.md) - プロンプト全体構造
- [スキルシステム](../features/skills.md) - オンデマンド読み込みとの併用
