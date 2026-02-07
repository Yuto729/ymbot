# システムプロンプト設計

## 概要

Moltbotは毎回**カスタムシステムプロンプト**を組み立てます。p-coding-agentのデフォルトプロンプトは使用しません。

## なぜカスタムプロンプトか

1. **コンパクト性**: 必要最小限の情報だけを含める
2. **キャッシュ効率**: 動的な値を避けてキャッシュヒット率を最大化
3. **柔軟性**: エージェントの種類（main/subagent）に応じて調整

## プロンプト構造

### 固定セクション（full モード）

```
1. Tooling
   - 現在利用可能なツールリスト
   - 各ツールの短い説明

2. Skills（利用可能な場合）
   - スキルの一覧（名前・説明・ファイルパス）
   - 「readツールでSKILL.mdを読んでね」という指示

3. Clawdbot Self-Update
   - config.apply と update.run の実行方法

4. Workspace
   - 作業ディレクトリ（agents.defaults.workspace）

5. Documentation
   - Clawdbotローカルドキュメントへのパス
   - いつドキュメントを読むべきか

6. Workspace Files (injected)
   - ブートストラップファイルが以下に含まれることの通知

7. Sandbox（有効時）
   - サンドボックスランタイム情報
   - サンドボックスパス
   - 昇格実行の可否

8. Current Date & Time
   - ユーザーローカル時刻、タイムゾーン、時刻フォーマット
   - 注：動的な時刻は含まない（キャッシュ安定性のため）

9. Reply Tags（対応プロバイダー）
   - 返信タグの構文

10. Heartbeats
    - ハートビートプロンプトとACK動作

11. Runtime
    - ホスト、OS、Node、モデル、リポジトリルート、思考レベル

12. Reasoning
    - 現在の可視性レベル + /reasoning トグルヒント
```

### プロンプトモード

| モード | 用途 | 含まれるセクション |
|--------|------|------------------|
| **full** | メインエージェント | 全12セクション |
| **minimal** | サブエージェント | Tooling, Workspace, Sandbox, Time, Runtime, 注入コンテキスト |
| **none** | 最小限 | アイデンティティ行のみ |

**minimal モードで省略されるもの**:
- Skills
- Memory Recall
- Clawdbot Self-Update
- Model Aliases
- User Identity
- Reply Tags
- Messaging
- Silent Replies
- Heartbeats

## 設計判断とその理由

### 1. スキルは参照のみ

**決定**: スキルの詳細をプロンプトに含めず、ファイルパスのみ

**理由**:
- プロンプトサイズを小さく保つ
- スキルが増えてもプロンプトサイズは一定
- 必要な時だけ `read` ツールで読み込む

**実装**:

```xml
<available_skills>
  <skill>
    <name>gmail</name>
    <description>Search and read Gmail</description>
    <location>~/.clawdbot/skills/gmail/SKILL.md</location>
  </skill>
</available_skills>
```

**プロンプト内の指示**:
> When you need to use a skill, use the `read` tool to load the SKILL.md at the listed location.

**メリット**:
- ✅ 10個のスキルがあっても、プロンプトには参照（3行×10）だけ
- ✅ スキルの内容が変わってもプロンプトは変わらない → キャッシュ安定
- ✅ 使わないスキルの詳細でトークンを消費しない

### 2. 時刻はタイムゾーンのみ

**決定**: 現在時刻を含めず、タイムゾーンのみ

**理由**: プロンプトキャッシュの安定性

**問題**: 現在時刻を含めると、毎回プロンプトが変わる

```python
# ❌ キャッシュ効率が悪い
system_prompt = f"""
Current time: {datetime.now().isoformat()}  # 毎回変わる
Timezone: Asia/Tokyo
"""
```

**解決策**: 時刻が必要な時は `session_status` ツール

```python
# ✅ キャッシュ効率が良い
system_prompt = """
Timezone: Asia/Tokyo
Time format: 24-hour

Use session_status tool when you need the current time.
"""
```

**設定**:

```json5
{
  agents: {
    defaults: {
      userTimezone: "Asia/Tokyo",
      timeFormat: "auto"  // "auto" | "12" | "24"
    }
  }
}
```

### 3. 固定セクション構造

**決定**: セクションの順序を固定

**理由**:
- 予測可能性
- テストしやすい
- ドキュメント化しやすい

**実装パターン**:

```python
def build_system_prompt(mode: str = "full") -> str:
    sections = []

    # 1. Tooling（常に含める）
    sections.append(format_tools_section())

    if mode == "full":
        # 2. Skills
        sections.append(format_skills_section())

        # 3. Self-Update
        sections.append(format_self_update_section())

    # 4. Workspace（常に含める）
    sections.append(format_workspace_section())

    if mode == "full":
        # 5. Documentation
        sections.append(format_documentation_section())

    # ... 以下同様

    return "\n\n".join(sections)
```

## プロンプト組み立てフロー

```
┌────────────────────────────────────────┐
│ Step 1: Configuration Loading          │
│  - Read agents.defaults                │
│  - Determine prompt mode               │
│  - Load workspace settings             │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Step 2: Fixed Sections Generation      │
│  - Tooling                             │
│  - Workspace                           │
│  - Runtime                             │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Step 3: Bootstrap Files Injection      │
│  - Read SOUL.md, IDENTITY.md, etc.    │
│  - Trim to max chars                   │
│  - Add missing file markers            │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Step 4: Skills References (full only)  │
│  - List eligible skills                │
│  - Format as XML                       │
│  - Add loading instructions            │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Step 5: Mode-Specific Sections         │
│  - Heartbeat (full only)               │
│  - Documentation (full only)           │
│  - Reply Tags (full only)              │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Step 6: Final Assembly                 │
│  - Join all sections                   │
│  - Return complete prompt              │
└────────────────────────────────────────┘
```

## プロンプトサイズの最適化

### ビフォー（ナイーブな実装）

```python
# 全スキルの詳細を含める
system_prompt = f"""
Available skills:

Gmail Skill:
{read_file('~/.clawdbot/skills/gmail/SKILL.md')}  # 2000トークン

Calendar Skill:
{read_file('~/.clawdbot/skills/calendar/SKILL.md')}  # 1500トークン

Tasks Skill:
{read_file('~/.clawdbot/skills/tasks/SKILL.md')}  # 1800トークン

... 10個のスキル
→ 合計 15,000トークン以上！
"""
```

### アフター（Moltbotの実装）

```python
# 参照のみ
system_prompt = """
Available skills:

<available_skills>
  <skill>
    <name>gmail</name>
    <description>Search and read Gmail</description>
    <location>~/.clawdbot/skills/gmail/SKILL.md</location>
  </skill>
  <skill>
    <name>calendar</name>
    <description>Work with Google Calendar</description>
    <location>~/.clawdbot/skills/calendar/SKILL.md</location>
  </skill>
  <!-- ... 10個のスキル -->
</available_skills>

Use the read tool to load SKILL.md when needed.
→ 合計 500トークン程度
"""
```

**削減率**: 96%以上のトークン削減！

## キャッシュ戦略

### キャッシュヒット率を最大化する設計

```python
class SystemPrompt:
    def __init__(self, config):
        # 静的な部分（キャッシュ可能）
        self.static_sections = self._build_static_sections(config)

    def build(self, context: dict) -> str:
        """
        プロンプト生成
        - 静的部分は変わらない → キャッシュヒット
        - 動的部分は最小限
        """
        sections = [self.static_sections]

        # 動的部分は含めない
        # 時刻 → session_status ツールで取得
        # スキル内容 → read ツールで取得

        return "\n\n".join(sections)
```

### キャッシュ無効化を避ける

**❌ 悪い例**:

```python
# プロンプトに動的な値を含める
system_prompt = f"""
Current time: {datetime.now()}  # 毎回変わる
Request ID: {uuid.uuid4()}      # 毎回変わる
"""
# → キャッシュが効かない
```

**✅ 良い例**:

```python
# プロンプトは静的に保つ
system_prompt = """
Timezone: Asia/Tokyo

Use session_status tool when you need the current time.
"""
# → キャッシュが効く

# 動的情報はツールで取得
def session_status():
    return {
        "current_time": datetime.now().isoformat(),
        "request_id": str(uuid.uuid4())
    }
```

## 実装例（raspi_todo_app向け）

```python
from typing import Literal, List
from pathlib import Path

PromptMode = Literal["full", "minimal", "none"]

class SystemPromptBuilder:
    def __init__(self, workspace: Path, config: dict):
        self.workspace = workspace
        self.config = config
        self.bootstrap_max_chars = config.get('bootstrapMaxChars', 20000)

    def build(self, mode: PromptMode = "full") -> str:
        """システムプロンプトを組み立てる"""
        sections = []

        # 1. Tooling（常に含める）
        sections.append(self._format_tooling())

        if mode == "full":
            # 2. Skills（参照のみ）
            sections.append(self._format_skills_references())

        # 3. Workspace
        sections.append(f"Working directory: {self.workspace}")

        # 4. Bootstrap Files（自動注入）
        sections.append(self._inject_bootstrap_files())

        if mode == "full":
            # 5. Documentation
            sections.append(self._format_documentation())

            # 6. Heartbeat
            sections.append(self._format_heartbeat_section())

        # 7. Runtime（常に含める）
        sections.append(self._format_runtime())

        return "\n\n".join(sections)

    def _format_tooling(self) -> str:
        """ツールリストのフォーマット"""
        return """
Available tools:
- read: Read files from the workspace
- write: Write files to the workspace
- exec: Execute shell commands
- session_status: Get current time and session info
"""

    def _format_skills_references(self) -> str:
        """スキル参照リストのフォーマット"""
        skills = self._discover_skills()

        skills_xml = "<available_skills>\n"
        for skill in skills:
            skills_xml += f"""  <skill>
    <name>{skill['name']}</name>
    <description>{skill['description']}</description>
    <location>{skill['path']}</location>
  </skill>\n"""
        skills_xml += "</available_skills>\n"
        skills_xml += "\nUse the read tool to load SKILL.md when you need to use a skill."

        return skills_xml

    def _inject_bootstrap_files(self) -> str:
        """ブートストラップファイルを注入"""
        bootstrap_files = [
            "IDENTITY.md",
            "SOUL.md",
            "AGENTS.md",
            "USER.md",
            "HEARTBEAT.md"
        ]

        content = "# Project Context\n\n"

        for filename in bootstrap_files:
            filepath = self.workspace / filename

            if filepath.exists():
                file_content = filepath.read_text()

                # トリミング
                if len(file_content) > self.bootstrap_max_chars:
                    file_content = file_content[:self.bootstrap_max_chars]
                    file_content += "\n[... truncated ...]"

                content += f"## {filename}\n\n{file_content}\n\n"
            else:
                content += f"## {filename}\n\n[File not found]\n\n"

        return content

    def _format_runtime(self) -> str:
        """ランタイム情報のフォーマット"""
        import platform
        return f"""
Runtime:
- OS: {platform.system()} {platform.release()}
- Python: {platform.python_version()}
- Workspace: {self.workspace}
"""

    def _discover_skills(self) -> List[dict]:
        """利用可能なスキルを発見"""
        skills_dir = Path.home() / ".raspi_todo_app" / "skills"
        skills = []

        if skills_dir.exists():
            for skill_dir in skills_dir.iterdir():
                if skill_dir.is_dir():
                    skill_file = skill_dir / "SKILL.md"
                    if skill_file.exists():
                        # メタデータを読む（先頭数行から）
                        skills.append({
                            "name": skill_dir.name,
                            "description": self._extract_description(skill_file),
                            "path": str(skill_file)
                        })

        return skills
```

## まとめ

```
★ システムプロンプト設計の3原則
  1. コンパクトに → スキルは参照のみ、動的情報はツールで
  2. キャッシュ効率 → 動的な値を避ける、固定セクション構造
  3. 段階的読み込み → 必要な情報だけをオンデマンドで取得
```

**効果**:
- ✅ トークン使用量 80%以上削減
- ✅ キャッシュヒット率 90%以上
- ✅ 応答速度 2-3倍向上

## 次のステップ

- [ブートストラップ注入](./bootstrap-injection.md) - ファイル注入の詳細
- [スキルシステム](../features/skills.md) - オンデマンド読み込みの実装
