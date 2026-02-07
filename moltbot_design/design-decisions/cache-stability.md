# 設計判断：キャッシュ安定性

## 問題

LLM APIはプロンプトキャッシュをサポートしていますが、プロンプトが変わるたびにキャッシュミスが発生します。

### キャッシュミスのコスト

```
リクエスト:
  1. プロンプト: "Current time: 2026-02-07 10:00:00"
     → キャッシュミス、フル処理

  2. プロンプト: "Current time: 2026-02-07 10:00:01"  # 1秒後
     → キャッシュミス、フル処理  ❌

  3. プロンプト: "Current time: 2026-02-07 10:00:02"  # 2秒後
     → キャッシュミス、フル処理  ❌
```

**問題**: 動的な値（時刻など）を含めると、キャッシュが無効化される

## 解決策

### 1. 動的な値を除外

**Before（ナイーブ）**:

```python
def build_prompt():
    return f"""
You are a helpful assistant.

Current time: {datetime.now().isoformat()}  # 毎回変わる
Current user: {get_current_user()}          # セッションごとに変わる
Request ID: {uuid.uuid4()}                  # 毎回変わる

...
"""
```

**キャッシュヒット率**: 0%（プロンプトが常に変わる）

**After（Moltbot）**:

```python
def build_prompt():
    return """
You are a helpful assistant.

Timezone: Asia/Tokyo  # 静的

Use session_status tool to get the current time.

...
"""
```

**キャッシュヒット率**: 90%以上

### 2. 動的情報はツールで取得

```python
# ツール定義
def session_status() -> dict:
    """現在のセッション状態を取得"""
    return {
        "current_time": datetime.now().isoformat(),
        "timezone": "Asia/Tokyo",
        "user": get_current_user(),
        "session_id": get_session_id()
    }

# エージェントが必要な時に呼び出し
# → プロンプトは静的に保たれる
```

## 設計原則

### 1. 静的プロンプトの原則

**ルール**: プロンプトには時間や状態に依存しない情報のみ

```
✅ 含めて良い:
  - タイムゾーン
  - ワークスペースパス
  - ツールリスト
  - スキル参照

❌ 含めてはいけない:
  - 現在時刻
  - セッションID
  - リクエストID
  - ユーザー状態
```

### 2. ツールによる遅延評価の原則

**ルール**: 動的情報は必要な時にツールで取得

```
Before:
  System Prompt に現在時刻を含める
  → 毎秒変わる
  → キャッシュミス

After:
  System Prompt に session_status ツールを含める
  → エージェントが必要な時に呼び出し
  → プロンプトは静的
```

### 3. セクション分離の原則

**ルール**: 変わる可能性のあるセクションと変わらないセクションを分離

```python
# 静的セクション（キャッシュ可能）
static_sections = [
    format_identity(),    # 変わらない
    format_tools(),       # 変わらない
    format_workspace(),   # 変わらない
]

# 動的セクション（キャッシュ不可）
dynamic_sections = [
    format_user_state(),  # 変わる可能性
]

# プロンプト構築
prompt = "\n\n".join(static_sections)
# dynamic_sections はツールで取得
```

## 実装パターン

### パターン1: 完全静的プロンプト

```python
class StaticPromptBuilder:
    def __init__(self, config: dict):
        # 設定から静的な値のみ抽出
        self.timezone = config['timezone']
        self.workspace = config['workspace']
        self.tools = config['tools']

        # プロンプトを一度だけ構築
        self._prompt = self._build_once()

    def _build_once(self) -> str:
        """起動時に一度だけ構築"""
        return f"""
You are a helpful assistant.

Timezone: {self.timezone}
Workspace: {self.workspace}

Available tools:
{self._format_tools(self.tools)}

Use session_status tool for dynamic information.
"""

    def get_prompt(self) -> str:
        """同じプロンプトを返す（キャッシュ効率MAX）"""
        return self._prompt
```

**キャッシュヒット率**: 95%以上

### パターン2: セクションキャッシュ

```python
class CachedPromptBuilder:
    def __init__(self):
        self._section_cache = {}

    def build(self, config: dict) -> str:
        sections = []

        # 静的セクション（キャッシュ）
        sections.append(self._get_cached_section("identity",
                                                  self._build_identity))
        sections.append(self._get_cached_section("tools",
                                                  self._build_tools))

        # 動的セクション（常に再構築）
        # → 含めない！ツールで取得

        return "\n\n".join(sections)

    def _get_cached_section(self, key: str, builder: callable) -> str:
        if key not in self._section_cache:
            self._section_cache[key] = builder()
        return self._section_cache[key]
```

### パターン3: バージョン管理

```python
class VersionedPromptBuilder:
    PROMPT_VERSION = "1.2.0"

    def build(self) -> str:
        """バージョン付きプロンプト"""
        prompt = self._build_static_prompt()

        # バージョンをコメントとして追加（デバッグ用）
        return f"<!-- Prompt v{self.PROMPT_VERSION} -->\n\n{prompt}"

    def invalidate_cache_if_needed(self, old_version: str) -> bool:
        """バージョンが変わったらキャッシュ無効化"""
        if old_version != self.PROMPT_VERSION:
            logger.info(f"Prompt version changed: {old_version} → {self.PROMPT_VERSION}")
            return True
        return False
```

## 時刻の扱い

### 問題：時刻をプロンプトに含めるとキャッシュが効かない

```python
# ❌ 悪い例
system_prompt = f"""
Current time: {datetime.now().isoformat()}  # 毎秒変わる
Timezone: Asia/Tokyo
"""

# 1秒ごとにキャッシュミス
# → コストが高い
```

### 解決策1: タイムゾーンのみ

```python
# ✅ 良い例
system_prompt = """
Timezone: Asia/Tokyo
Time format: 24-hour

Use session_status tool when you need the current time.
"""

# プロンプトは静的
# → キャッシュヒット
```

### 解決策2: session_status ツール

```python
def session_status() -> dict:
    """動的情報を取得"""
    now = datetime.now(pytz.timezone("Asia/Tokyo"))

    return {
        "current_time": now.isoformat(),
        "current_date": now.strftime("%Y-%m-%d"),
        "day_of_week": now.strftime("%A"),
        "timezone": "Asia/Tokyo"
    }

# エージェントが必要な時に呼び出し
# Agent: [session_status]
# Result: {"current_time": "2026-02-07T15:30:00+09:00", ...}
```

## スキルの扱い

### 問題：スキルの内容をプロンプトに含めると更新のたびにキャッシュミス

```python
# ❌ 悪い例
system_prompt = f"""
Gmail Skill:
{read_file('gmail/SKILL.md')}  # スキル更新のたびにキャッシュミス

Calendar Skill:
{read_file('calendar/SKILL.md')}  # スキル更新のたびにキャッシュミス
"""
```

### 解決策：参照のみ

```python
# ✅ 良い例
system_prompt = """
<available_skills>
  <skill>
    <name>gmail</name>
    <location>~/.skills/gmail/SKILL.md</location>
  </skill>
  <skill>
    <name>calendar</name>
    <location>~/.skills/calendar/SKILL.md</location>
  </skill>
</available_skills>

Use read tool to load SKILL.md when needed.
"""

# スキルが更新されても、プロンプトは不変
# → キャッシュヒット
```

## 測定

### キャッシュヒット率の測定

```python
class CacheMetrics:
    def __init__(self):
        self.total_requests = 0
        self.cache_hits = 0
        self.cache_misses = 0

    def record_request(self, was_cached: bool):
        self.total_requests += 1
        if was_cached:
            self.cache_hits += 1
        else:
            self.cache_misses += 1

    def get_hit_rate(self) -> float:
        if self.total_requests == 0:
            return 0.0
        return self.cache_hits / self.total_requests

    def get_stats(self) -> dict:
        return {
            "total_requests": self.total_requests,
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "hit_rate": self.get_hit_rate(),
            "estimated_savings": self.cache_hits * 0.000003 * 500  # Sonnetで500トークン
        }

# 使用例
metrics = CacheMetrics()
# ... リクエスト処理 ...
print(metrics.get_stats())
# {
#   "total_requests": 1000,
#   "cache_hits": 900,
#   "cache_misses": 100,
#   "hit_rate": 0.9,
#   "estimated_savings": 1.35  # $1.35 saved
# }
```

### コスト比較

```
シナリオ: 10万リクエスト/月、500トークンプロンプト

動的プロンプト（キャッシュヒット率 0%）:
  入力トークン: 100,000 × 500 = 50,000,000
  コスト: 50,000,000 × $0.000003 = $150

静的プロンプト（キャッシュヒット率 90%）:
  キャッシュミス: 10,000 × 500 = 5,000,000
  キャッシュヒット: 90,000 × 500 × 0.1 = 4,500,000  # 10倍安い
  合計トークン: 9,500,000
  コスト: $28.50

削減額: $121.50/月
削減率: 81%
```

## ベストプラクティス

### 1. プロンプトの不変部分を特定

```python
# チェックリスト
invariant_checks = {
    "timezone": "変わらない",
    "workspace": "変わらない",
    "tools_list": "変わらない",
    "current_time": "変わる ❌",
    "user_state": "変わる ❌",
    "session_id": "変わる ❌"
}

# 変わるものはツールで取得
dynamic_tools = [
    "session_status",
    "user_profile",
]
```

### 2. キャッシュ無効化の監視

```python
def monitor_cache_invalidation():
    """キャッシュ無効化の原因を追跡"""
    prompt_history = []

    def build_and_track(config):
        prompt = build_prompt(config)
        prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()

        if prompt_history and prompt_history[-1] != prompt_hash:
            logger.warning(f"Prompt changed, cache invalidated")
            logger.debug(f"Old hash: {prompt_history[-1]}")
            logger.debug(f"New hash: {prompt_hash}")

        prompt_history.append(prompt_hash)
        return prompt
```

### 3. セクション別のキャッシュ戦略

```python
class SmartPromptBuilder:
    def build(self, mode: str) -> str:
        # 常にキャッシュ可能（完全に静的）
        always_cached = [
            self.format_identity(),
            self.format_tools(),
        ]

        # 設定変更時のみ変わる（ほぼ静的）
        config_dependent = [
            self.format_workspace(),
            self.format_skills_refs(),
        ]

        # 決して含めない（動的）
        # - 現在時刻
        # - セッション状態
        # → ツールで取得

        return "\n\n".join(always_cached + config_dependent)
```

## まとめ

```
★ キャッシュ安定性の3原則

1. 静的プロンプトの原則
   プロンプトには時間や状態に依存しない情報のみ

2. ツールによる遅延評価の原則
   動的情報は必要な時にツールで取得

3. セクション分離の原則
   変わるセクションと変わらないセクションを分離
```

**効果**:
- ✅ キャッシュヒット率 90%以上
- ✅ コスト 81%削減
- ✅ レイテンシ 60%削減（キャッシュヒット時）

**実装のポイント**:
- 時刻はタイムゾーンのみ、詳細は `session_status`
- スキルは参照のみ、詳細は `read`
- ユーザー状態はツールで取得

## 次のステップ

- [プロンプトのコンパクト性](./prompt-compactness.md) - サイズ最適化
- [オンデマンド読み込み](./on-demand-loading.md) - 実装パターン
