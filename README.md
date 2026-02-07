# YMBot

自律駆動型 AI エージェント（Claude Agent SDK ベース）

## 概要

YMBot は Claude Agent SDK を使用して構築された自律型 AI エージェントです。
逐次起動型のサーバーとして実装されており、リクエストごとに Claude と対話します。

## 特徴

- 🤖 **Claude Agent SDK**: Claude の最新エージェント機能を活用
- 📦 **Skills サポート**: ファイルシステムベースの拡張可能なスキルシステム
- 📝 **見やすいログ**: カラフルなターミナルログで動作状況を把握
- 🔧 **TypeScript**: 型安全な開発環境

## 必要要件

- Node.js 20+
- npm または pnpm

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発モードで起動
npm run dev

# ビルド
npm run build

# 本番起動
npm start
```

## ディレクトリ構造

```
ymbot/
├── src/
│   ├── index.ts          # エントリーポイント
│   └── utils/
│       └── logger.ts     # ロガー
├── docs/                 # ドキュメント
├── moltbot_design/       # 設計思想ドキュメント
├── package.json
└── tsconfig.json
```

## ログレベル

ロガーは以下のレベルをサポートしています：

- `debug`: デバッグ情報（灰色）
- `info`: 一般情報（青）
- `warn`: 警告（黄）
- `error`: エラー（赤）
- `success`: 成功メッセージ（緑）

## ドキュメント

- [自律型エージェント実装ガイド](./docs/autonomous-agent.md)
- [Moltbot 設計原則](./moltbot_design/README.md)

## ライセンス

ISC
