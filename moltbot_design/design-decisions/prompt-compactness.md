# 設計判断：プロンプトのコンパクト性

## 問題

大きなシステムプロンプトは以下の問題を引き起こします：

1. **コスト増**: トークン使用量 ∝ プロンプトサイズ
2. **レイテンシ増**: 処理時間 ∝ プロンプトサイズ
3. **スケーラビリティ低下**: 機能追加のたびにプロンプト肥大化
4. **キャッシュ効率低下**: 大きなプロンプトはキャッシュミスしやすい

## 測定

### ナイーブな実装

```python
# すべてのスキルを注入
system_prompt = f"""
You are a helpful assistant.

Available skills:

Gmail Skill:
{read_file('gmail/SKILL.md')}     # 2,000トークン

Calendar Skill:
{read_file('calendar/SKILL.md')}  # 1,500トークン

Tasks Skill:
{read_file('tasks/SKILL.md')}     # 1,800トークン

Weather Skill:
{read_file('weather/SKILL.md')}   # 1,200トークン

News Skill:
{read_file('news/SKILL.md')}      # 1,000トークン

... 10個のスキル
"""

# 合計: 15,000トークン
# API呼び出しあたりのコスト（Claude Opus）: $0.225
# 1000回呼び出し: $225
```

### Moltbotの実装

```python
# 参照のみ
system_prompt = """
You are a helpful assistant.

Available skills:
<available_skills>
  <skill>
    <name>gmail</name>
    <description>Gmail management</description>
    <location>~/.skills/gmail/SKILL.md</location>
  </skill>
  <!-- ... 10個のスキル -->
</available_skills>

Use read tool to load SKILL.md when needed.
"""

# 合計: 500トークン
# API呼び出しあたりのコスト: $0.0075
# 1000回呼び出し: $7.50
# 削減率: 96.7%
# コスト削減: $217.50
```

## 設計原則

### 1. 参照の原則

**ルール**: 大きなデータは参照のみ、詳細はオンデマンド読み込み

```
❌ 全データ注入:
  System Prompt: [全スキルの詳細]
  サイズ: 15,000トークン

✅ 参照のみ:
  System Prompt: [スキル名 + パス]
  サイズ: 500トークン
  必要な時: read SKILL.md
```

### 2. 固定セクションの原則

**ルール**: セクション構造を固定し、予測可能に

```python
def build_prompt():
    sections = []
    sections.append(tooling_section())      # 常に同じ構造
    sections.append(skills_section())       # 常に同じ構造
    sections.append(workspace_section())    # 常に同じ構造
    return "\n\n".join(sections)
```

**メリット**:
- テストしやすい
- ドキュメント化しやすい
- デバッグしやすい

### 3. 必要最小限の原則

**ルール**: 絶対に必要な情報だけを含める

```
必要:
  - ツールリスト（エージェントの能力）
  - ワークスペース情報（作業場所）
  - ランタイム情報（実行環境）

不要:
  - スキルの詳細（オンデマンド）
  - 現在時刻（session_status で取得）
  - ユーザーのフルプロフィール（必要な部分のみ）
```

## トレードオフ分析

### メリット

#### 1. コスト削減

```
プロンプトサイズ:
  Before: 15,000トークン
  After:     500トークン
  削減率:     96.7%

月間コスト（10万リクエスト）:
  Before: $22,500
  After:     $750
  削減額: $21,750
```

#### 2. レイテンシ削減

```
処理時間（推定）:
  Before: 3.5秒
  After:  0.8秒
  改善率: 77%
```

#### 3. スケーラビリティ

```
スキル数とプロンプトサイズ:
  Before: 10スキル → 15,000トークン
          20スキル → 30,000トークン  ❌ スケールしない

  After:  10スキル → 500トークン
          20スキル → 500トークン     ✅ スケールする
```

#### 4. キャッシュ効率

```
キャッシュヒット率:
  Before: 30%（プロンプトが頻繁に変わる）
  After:  90%（プロンプトが安定）

実効コスト削減:
  キャッシュありの場合、さらに 75%削減
```

### デメリット

#### 1. 追加のツール呼び出し

```
Before:
  User: "メール確認して"
  Agent: [すでにGmailスキルの情報がある]
  Agent: [Gmailコマンド実行]
  → 1回のツール呼び出し

After:
  User: "メール確認して"
  Agent: [read gmail/SKILL.md]
  Agent: [Gmailコマンド実行]
  → 2回のツール呼び出し
```

**緩和策**:
- `read` は軽量（ファイル読み込みのみ）
- 一度読めばセッション内で再利用
- SKILL.md は小さく保つ（< 2000トークン）

#### 2. 初回レイテンシ増加

```
初回リクエスト:
  Before: 0.8秒
  After:  1.2秒（read 追加で +0.4秒）

2回目以降:
  Before: 0.8秒
  After:  0.8秒（既にスキル読み込み済み）
```

**緩和策**:
- よく使うスキルは事前読み込み（オプション）
- ブートストラップファイルで基本情報を提供

## 実装パターン

### パターン1: 完全にコンパクト

```python
class CompactPromptBuilder:
    def build(self) -> str:
        return "\n\n".join([
            self.format_identity(),        # 50トークン
            self.format_tools(),           # 100トークン
            self.format_skills_refs(),     # 200トークン
            self.format_workspace(),       # 50トークン
            self.format_runtime(),         # 100トークン
        ])
        # 合計: 500トークン
```

### パターン2: ハイブリッド（ブートストラップ注入）

```python
class HybridPromptBuilder:
    def build(self) -> str:
        return "\n\n".join([
            self.format_identity(),        # 50トークン
            self.format_tools(),           # 100トークン
            self.format_skills_refs(),     # 200トークン
            self.inject_bootstrap(),       # 3,000トークン（制限あり）
            self.format_workspace(),       # 50トークン
            self.format_runtime(),         # 100トークン
        ])
        # 合計: 3,500トークン（依然として大幅削減）
```

**判断**:
- ブートストラップファイル（SOUL.md, IDENTITY.md など）は頻繁に参照される
- これらは注入しても良い（ただしサイズ制限付き）
- スキルは参照のみ（頻繁には参照されない）

### パターン3: 適応型

```python
class AdaptivePromptBuilder:
    def build(self, context: dict) -> str:
        # 使用頻度に基づいて判断
        frequently_used_skills = self.get_frequent_skills(context)

        sections = [
            self.format_identity(),
            self.format_tools(),
        ]

        # 頻繁に使うスキル（トップ3）は注入
        if frequently_used_skills:
            sections.append(
                self.inject_frequent_skills(frequently_used_skills[:3])
            )

        # その他のスキルは参照のみ
        sections.append(self.format_skills_refs())

        return "\n\n".join(sections)
```

## ベストプラクティス

### 1. サイズを測定する

```python
def measure_prompt_size(prompt: str) -> dict:
    """プロンプトサイズを測定"""
    import tiktoken

    enc = tiktoken.encoding_for_model("claude-3-5-sonnet-20241022")
    tokens = len(enc.encode(prompt))

    return {
        "characters": len(prompt),
        "tokens": tokens,
        "estimated_cost_input": tokens * 0.000003,  # Sonnet入力
        "estimated_cost_output": tokens * 0.000015  # Sonnet出力（参考）
    }

# 使用例
stats = measure_prompt_size(system_prompt)
print(f"Tokens: {stats['tokens']}")
print(f"Cost per call: ${stats['estimated_cost_input']:.4f}")
```

### 2. 定期的にレビュー

```bash
# プロンプトサイズのトレンド監視
clawdbot context list --json | jq '.prompt_size'

# 月次レポート
clawdbot analytics prompt-size --month 2026-02
```

### 3. セクションごとの貢献を追跡

```python
def analyze_prompt_sections(prompt_builder) -> dict:
    """各セクションのトークン貢献を分析"""
    sections = {
        "identity": prompt_builder.format_identity(),
        "tools": prompt_builder.format_tools(),
        "skills": prompt_builder.format_skills_refs(),
        "bootstrap": prompt_builder.inject_bootstrap(),
        "workspace": prompt_builder.format_workspace(),
        "runtime": prompt_builder.format_runtime(),
    }

    analysis = {}
    for name, content in sections.items():
        stats = measure_prompt_size(content)
        analysis[name] = stats

    return analysis

# 出力例:
# {
#   "identity": {"tokens": 50, "cost": 0.00015},
#   "tools": {"tokens": 100, "cost": 0.0003},
#   "skills": {"tokens": 200, "cost": 0.0006},
#   "bootstrap": {"tokens": 3000, "cost": 0.009},
#   "workspace": {"tokens": 50, "cost": 0.00015},
#   "runtime": {"tokens": 100, "cost": 0.0003}
# }
```

## まとめ

```
★ プロンプトのコンパクト性の原則

1. 参照の原則
   大きなデータは参照のみ、詳細はオンデマンド

2. 固定セクションの原則
   予測可能な構造を維持

3. 必要最小限の原則
   絶対に必要な情報だけを含める
```

**効果**:
- ✅ トークン使用量 96%削減
- ✅ コスト $21,750/月 削減（10万リクエスト）
- ✅ レイテンシ 77%改善
- ✅ スケーラビリティ向上

**トレードオフ**:
- ❌ 初回に追加のツール呼び出し（+0.4秒）
- ✅ 2回目以降は同等
- ✅ 全体的なメリットがはるかに大きい

## 次のステップ

- [キャッシュ安定性](./cache-stability.md) - キャッシュ最適化戦略
- [オンデマンド読み込み](./on-demand-loading.md) - 詳細な実装パターン
