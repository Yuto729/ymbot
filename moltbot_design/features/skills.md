# スキルシステム

## 概要

Moltbotのスキルシステムは**オンデマンド読み込み**を採用し、システムプロンプトをコンパクトに保ちながらスケーラブルな拡張を可能にします。

## 基本コンセプト

### 従来の問題：すべてを注入

```python
# ❌ ナイーブな実装
system_prompt = f"""
Gmail Skill:
{read_file('~/.skills/gmail/SKILL.md')}  # 2000トークン

Calendar Skill:
{read_file('~/.skills/calendar/SKILL.md')}  # 1500トークン

Tasks Skill:
{read_file('~/.skills/tasks/SKILL.md')}  # 1800トークン

... 10個のスキル
→ 合計 15,000トークン以上！
"""
```

**問題**:
- プロンプトが巨大化
- 使わないスキルでもトークン消費
- スキル追加のたびにプロンプトサイズ増加

### Moltbotの解決策：参照のみ

```python
# ✅ Moltbotの実装
system_prompt = """
<available_skills>
  <skill>
    <name>gmail</name>
    <description>Search and read Gmail</description>
    <location>~/.skills/gmail/SKILL.md</location>
  </skill>
  <skill>
    <name>calendar</name>
    <description>Work with Google Calendar</description>
    <location>~/.skills/calendar/SKILL.md</location>
  </skill>
  <!-- ... 10個のスキル -->
</available_skills>

Use the read tool to load SKILL.md when you need to use a skill.
→ 合計 500トークン程度
"""
```

**削減率**: 96%以上のトークン削減！

## スキルの構造

### ディレクトリレイアウト

```
~/.raspi_todo_app/skills/
├── gmail/
│   ├── SKILL.md          # スキル定義（必須）
│   └── examples/         # サンプルコード（オプション）
├── calendar/
│   ├── SKILL.md
│   └── config.json       # スキル設定（オプション）
└── tasks/
    └── SKILL.md
```

### SKILL.md フォーマット

```md
---
name: gmail
description: Search and read Gmail
version: 1.0.0
requires: [gog]
---

# Gmail Skill

## Description
Search and read Gmail messages using the gog CLI.

## Usage

### Check unread emails
\`\`\`bash
gog gmail list --unread --max-results 10
\`\`\`

### Search for specific sender
\`\`\`bash
gog gmail list --query "from:example@example.com"
\`\`\`

### Read email by ID
\`\`\`bash
gog gmail read <message-id>
\`\`\`

## Examples

Check urgent emails:
\`\`\`bash
gog gmail list --query "is:unread label:urgent" --max-results 5
\`\`\`

## Error Handling

- If `gog` is not installed: Install with `pip install gog-cli`
- If authentication fails: Run `gog auth` first
```

## オンデマンド読み込みフロー

```
┌────────────────────────────────────────┐
│ Phase 1: System Prompt（参照のみ）     │
├────────────────────────────────────────┤
│                                        │
│  <available_skills>                    │
│    <skill>                             │
│      <name>gmail</name>                │
│      <location>~/.../gmail/SKILL.md</location> │
│    </skill>                            │
│  </available_skills>                   │
│                                        │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Phase 2: User Request                  │
├────────────────────────────────────────┤
│                                        │
│  User: "未読メールをチェックして"       │
│                                        │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Phase 3: Agent Decides                 │
├────────────────────────────────────────┤
│                                        │
│  Agent: "gmailスキルが必要だ"           │
│         → read ~/.../gmail/SKILL.md    │
│                                        │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Phase 4: Load Skill                    │
├────────────────────────────────────────┤
│                                        │
│  [SKILL.mdの内容を読み込む]             │
│  - コマンド構文                         │
│  - 使用例                              │
│  - エラーハンドリング                   │
│                                        │
└──────────────┬─────────────────────────┘
               ↓
┌────────────────────────────────────────┐
│ Phase 5: Execute                       │
├────────────────────────────────────────┤
│                                        │
│  Agent: gog gmail list --unread        │
│  Result: "3件の未読メールがあります"    │
│                                        │
└────────────────────────────────────────┘
```

## なぜオンデマンドか

### 1. プロンプトサイズ削減

```
10個のスキル:

全注入:     15,000トークン
参照のみ:      500トークン
────────────────────────
削減率:        96.7%
```

### 2. キャッシュ効率

```python
# スキルの内容が変わっても...
skill_content = read_file("gmail/SKILL.md")  # 変更あり

# システムプロンプトは不変
system_prompt = """
<skill>
  <name>gmail</name>
  <location>~/.../gmail/SKILL.md</location>
</skill>
"""  # 変わらない → キャッシュヒット
```

### 3. スケーラビリティ

```
スキル数:     10個 → 100個
プロンプト:  500トークン → 500トークン（変わらず！）
```

スキルが増えてもプロンプトサイズは一定。

### 4. 選択的読み込み

```
リクエスト: "メール確認して"
  → gmailスキルのみ読み込み
  → calendar, tasks は読み込まない
  → 不要なトークン消費なし
```

## スキル発見

### 自動発見

```python
from pathlib import Path
from typing import List, Dict

class SkillDiscovery:
    def __init__(self, skills_dir: Path):
        self.skills_dir = skills_dir

    def discover(self) -> List[Dict[str, str]]:
        """利用可能なスキルを発見"""
        skills = []

        if not self.skills_dir.exists():
            return skills

        for skill_dir in self.skills_dir.iterdir():
            if not skill_dir.is_dir():
                continue

            skill_file = skill_dir / "SKILL.md"
            if not skill_file.exists():
                continue

            # メタデータ抽出
            metadata = self._extract_metadata(skill_file)

            skills.append({
                "name": skill_dir.name,
                "description": metadata.get("description", ""),
                "path": str(skill_file),
                "version": metadata.get("version", "1.0.0")
            })

        return skills

    def _extract_metadata(self, skill_file: Path) -> dict:
        """SKILL.mdからメタデータを抽出"""
        content = skill_file.read_text()

        # YAML frontmatter を抽出
        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                import yaml
                return yaml.safe_load(parts[1])

        # フォールバック: 先頭から推測
        lines = content.split("\n")
        description = ""
        for line in lines:
            if line.startswith("# "):
                description = line[2:].strip()
                break

        return {"description": description}
```

### スキルリストのフォーマット

```python
def format_skills_section(skills: List[Dict[str, str]]) -> str:
    """スキル参照リストをXMLフォーマット"""
    if not skills:
        return ""

    xml = "<available_skills>\n"

    for skill in skills:
        xml += f"""  <skill>
    <name>{skill['name']}</name>
    <description>{skill['description']}</description>
    <location>{skill['path']}</location>
  </skill>\n"""

    xml += "</available_skills>\n\n"
    xml += "Use the read tool to load SKILL.md when you need to use a skill.\n"

    return xml
```

## スキル読み込み戦略

### エージェントの判断プロセス

```
1. ユーザーリクエスト分析
   "未読メール確認して"
   ↓
2. 必要なスキル特定
   available_skills から「gmail」を選択
   ↓
3. スキル読み込み
   read ~/.../gmail/SKILL.md
   ↓
4. コマンド構築
   SKILL.mdの情報を元に:
   gog gmail list --unread --max-results 10
   ↓
5. 実行
```

### プロンプト内の指示

```
When you need to use a skill:

1. Check the <available_skills> list
2. Find the relevant skill by name or description
3. Use the read tool to load the SKILL.md at the listed location
4. Follow the instructions in SKILL.md
5. Execute the skill commands

Example:
User: "Check my emails"
→ Read ~/.raspi_todo_app/skills/gmail/SKILL.md
→ Execute: gog gmail list --unread
```

## スキルのベストプラクティス

### 1. 明確な説明

```md
---
name: gmail
description: Search, read, and manage Gmail messages
---

❌ 悪い説明:
description: Gmail stuff

✅ 良い説明:
description: Search, read, and manage Gmail messages using gog CLI
```

### 2. 実用例を含める

```md
## Examples

### Check urgent emails
\`\`\`bash
gog gmail list --query "is:unread label:urgent" --max-results 5
\`\`\`

### Search by sender
\`\`\`bash
gog gmail list --query "from:boss@company.com is:unread"
\`\`\`

### Read specific email
\`\`\`bash
gog gmail read 18a3f2e1b9c8d7f6
\`\`\`
```

### 3. エラーハンドリング

```md
## Error Handling

### Authentication Error
If you see "Authentication failed":
1. Run `gog auth` to re-authenticate
2. Follow the OAuth flow

### Not Found Error
If skill command is not found:
1. Install: `pip install gog-cli`
2. Verify: `which gog`

### Rate Limit Error
If you hit rate limits:
1. Wait 60 seconds
2. Reduce --max-results
```

### 4. 依存関係の明示

```md
---
name: gmail
requires:
  - gog-cli (pip install gog-cli)
  - OAuth credentials (~/.gog/credentials.json)
---

## Prerequisites

Before using this skill:
1. Install gog: `pip install gog-cli`
2. Authenticate: `gog auth`
3. Test: `gog gmail list --max-results 1`
```

## スキルのバージョン管理

### バージョン指定

```md
---
name: gmail
version: 2.1.0
---
```

### 互換性チェック

```python
class SkillManager:
    def load_skill(self, name: str, min_version: str = None) -> str:
        """スキルを読み込み、バージョンチェック"""
        skill_path = self.skills_dir / name / "SKILL.md"

        if not skill_path.exists():
            raise SkillNotFoundError(f"Skill {name} not found")

        content = skill_path.read_text()
        metadata = self._extract_metadata(content)

        # バージョンチェック
        if min_version:
            skill_version = metadata.get("version", "1.0.0")
            if not self._version_compatible(skill_version, min_version):
                raise SkillVersionError(
                    f"Skill {name} version {skill_version} "
                    f"< required {min_version}"
                )

        return content

    def _version_compatible(self, current: str, required: str) -> bool:
        """バージョン互換性チェック"""
        from packaging import version
        return version.parse(current) >= version.parse(required)
```

## スキルテスト

### テストスクリプト

```python
import subprocess
from pathlib import Path

class SkillTester:
    def test_skill(self, skill_name: str) -> bool:
        """スキルが正常に動作するかテスト"""
        skill_path = self.skills_dir / skill_name / "SKILL.md"

        if not skill_path.exists():
            print(f"❌ {skill_name}: SKILL.md not found")
            return False

        # メタデータ検証
        metadata = self._extract_metadata(skill_path)
        if not metadata.get("name"):
            print(f"❌ {skill_name}: Missing name in metadata")
            return False

        # 依存関係チェック
        requires = metadata.get("requires", [])
        for dep in requires:
            if not self._check_dependency(dep):
                print(f"❌ {skill_name}: Missing dependency {dep}")
                return False

        print(f"✅ {skill_name}: All checks passed")
        return True

    def _check_dependency(self, dep: str) -> bool:
        """依存関係が満たされているかチェック"""
        # 例: "gog-cli" → "gog" コマンドが存在するか
        cmd = dep.split()[0].replace("-cli", "")
        result = subprocess.run(
            ["which", cmd],
            capture_output=True,
            text=True
        )
        return result.returncode == 0
```

## 実装例（raspi_todo_app）

```python
from pathlib import Path
from typing import List, Dict

class SkillManager:
    def __init__(self, skills_dir: Path):
        self.skills_dir = skills_dir
        self.discovery = SkillDiscovery(skills_dir)

    def format_for_prompt(self) -> str:
        """システムプロンプト用のスキルリストを生成"""
        skills = self.discovery.discover()

        if not skills:
            return ""

        xml = "# Available Skills\n\n<available_skills>\n"

        for skill in skills:
            xml += f"""  <skill>
    <name>{skill['name']}</name>
    <description>{skill['description']}</description>
    <location>{skill['path']}</location>
  </skill>\n"""

        xml += "</available_skills>\n\n"
        xml += (
            "When you need to use a skill, use the read tool to load "
            "the SKILL.md at the listed location. "
            "The skill documentation includes usage examples and commands.\n"
        )

        return xml

    def load_skill(self, name: str) -> str:
        """スキルの詳細を読み込み"""
        skill_path = self.skills_dir / name / "SKILL.md"

        if not skill_path.exists():
            raise FileNotFoundError(f"Skill {name} not found at {skill_path}")

        return skill_path.read_text()


# 使用例
skills_dir = Path.home() / ".raspi_todo_app" / "skills"
skill_manager = SkillManager(skills_dir)

# システムプロンプトに含める
skills_section = skill_manager.format_for_prompt()

# エージェントが必要な時に読み込み
gmail_skill = skill_manager.load_skill("gmail")
```

## まとめ

```
★ スキルシステムの3つの柱

1. 参照のみ注入 → プロンプトサイズ 96%削減
2. オンデマンド読み込み → 必要な時だけ読み込み
3. スケーラビリティ → スキル数に依存しないプロンプトサイズ
```

**効果**:
- ✅ トークン使用量 大幅削減
- ✅ キャッシュヒット率 向上
- ✅ スキル追加が容易（プロンプト変更不要）
- ✅ 保守性向上（スキルごとに独立）

## 次のステップ

- [システムプロンプト設計](../architecture/system-prompt.md) - プロンプト全体構造
- [オンデマンド読み込み](../design-decisions/on-demand-loading.md) - 設計判断の詳細
