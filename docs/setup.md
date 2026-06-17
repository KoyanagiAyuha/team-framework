# セットアップ（consumer 向け）

team-framework を別プロジェクト／別マシンで使うための最低限の手順。

## 1. 前提（マシンごとに1回）

Agent Teams を有効化する。`~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" } }
```

> 必須はこれだけ。permission や個人の好み（テーマ等）は各自の設定で。permission は使用中の許可プロンプトで「常に許可」を選べば自動で溜まる。

## 2. インストール

```bash
/plugin marketplace add KoyanagiAyuha/team-framework
/plugin install team-framework@koyanagi-plugins
```

> install の詳細・開発時のローカル読み込み（`--plugin-dir`）は [README](../README.md) を参照。

## 3. 起動

```
/team-framework:team
```

使い方・後半パイプライン（worker-critic）の呼び出しは [README](../README.md) に記載。

## プロジェクト側に置くもの（任意）

フレームワーク本体はプラグインが供給するので、各プロジェクトの `.claude/` には**そのプロジェクト固有のものだけ**を薄く置けばよい（無くても動く）:

- `settings.json` … そのプロジェクト固有の permission（使用中の許可で自動蓄積される）
- `CLAUDE.md` … プロジェクト固有のコンテキストのみ（薄くてよい）
- `.claude/status/` の dashboard は実行時に自動生成される

> 設計の背景（変更頻度と共有範囲で3層に分ける考え方）は [handoff.md](handoff.md)。
