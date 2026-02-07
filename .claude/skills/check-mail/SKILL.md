---
name: check-mail
description: Gmail検索スキル。メールの確認・検索が必要なときに使用する。「メール確認して」「未読メールある？」「○○からのメール探して」などのリクエストで発動。gog CLIを使用。
---

# Check Mail

gog gmail searchでGmailを検索する。

## アカウント

| 用途 | アカウント |
|---|---|
| デフォルト | `mitomi.yuuto2003@gmail.com` |
| 大学 | `mitomiyuto2003@g.ecc.u-tokyo.ac.jp` |
| 就活 | `yuto.mitomi0213@gmail.com` |

指定がなければデフォルトアカウントを使用。複数アカウントを確認する場合は並列実行する。

## コマンド

```bash
# 直近のメール一覧（全件）
gog gmail search "in:anywhere" --max=10 --account=<ACCOUNT>

# 未読メール
gog gmail search "is:unread" --max=10 --account=<ACCOUNT>

# キーワード検索
gog gmail search "キーワード" --account=<ACCOUNT>

# 差出人で検索
gog gmail search "from:example@gmail.com" --account=<ACCOUNT>

# 日付で絞り込み
gog gmail search "after:2026/02/01 before:2026/02/03" --account=<ACCOUNT>

# 件数を増やす
gog gmail search "クエリ" --max=20 --account=<ACCOUNT>

# 特定メールの詳細取得
gog gmail get <messageId> --account=<ACCOUNT>
```

## 注意

- **特に指定がない場合は `"in:anywhere"` で全メールを検索する**（未読のみ等の絞り込みはユーザーの指示があるときだけ）
- 検索クエリはGmail検索構文に準拠（`from:`, `to:`, `subject:`, `is:unread`, `has:attachment`, `after:`, `before:` 等）
- 結果はテーブル形式で整理して表示する

## 重要な制約

**このスキルは読み取り専用です。**

✅ 許可されているコマンド:
- `gog help` - ヘルプ表示
- `gog gmail help` - Gmail コマンドのヘルプ
- `gog gmail search` - スレッド検索
- `gog gmail messages search` - メッセージ検索
- `gog gmail get <messageId>` - メール詳細取得
- `gog auth list` - 認証済みアカウント確認

❌ 禁止されているコマンド:
- `gog gmail send` - メール送信（絶対に使用禁止）
- `gog gmail drafts create` - 下書き作成（絶対に使用禁止）
- `gog gmail drafts send` - 下書き送信（絶対に使用禁止）
- その他の書き込み系コマンド全て

**違反した場合、セキュリティログに記録されます。**
