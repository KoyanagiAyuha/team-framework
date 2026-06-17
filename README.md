# team-framework

関数ベース × ハイブリッドの**マルチエージェント開発フレームワーク**を、Claude Code プラグインとして配布するリポジトリ。

肩書き（部長/課長…）ではなく**認知機能で役割を定義**し、前半は動的な **Agent Teams**、後半は決定論的な **Workflow** で回すハイブリッド構成。Critic が実コード・実挙動で裏取りする**検証ゲート**を必ず通すのが肝。

## 役割（関数ベース）

| 役割 | 機能 | 実体 |
|---|---|---|
| Engineer | 外部オペレーター（human-in-the-loop）。階層の頂点ではない | 人間（あなた） |
| Orchestrator | 全体統括・軽い分解・進捗管理 | main session |
| Planner | 重い分解・実行計画（軽い分解なら立てない） | teammate `team-framework:planner` |
| Worker | 隔離コンテキストで並列実装 | teammate / Workflow `team-framework:worker` |
| Critic | 成果物を敵対的に検証する関門（自己申告を信じない） | teammate / Workflow `team-framework:critic` |

```
Engineer → Orchestrator ┬─【動的: Agent Teams】前半（理解・分解・設計相談）
                        └─【決定論: Workflow】後半（実装・検証）= worker-critic.mjs
```

## インストール

このリポジトリは marketplace 同居構成（root `.claude-plugin/marketplace.json` に `team-framework` を収録）。

```bash
# 1. marketplace を追加（private repo なので git 認証が必要。複数アカウント環境ではSSH URL明示が確実）
/plugin marketplace add KoyanagiAyuha/team-framework
#   または: /plugin marketplace add git@github.com:KoyanagiAyuha/team-framework.git

# 2. プラグインを install（user scope = 全プロジェクトで有効）
/plugin install team-framework@koyanagi-plugins
```

install すると名前空間付きで使える:
- agent type: `team-framework:planner` / `:worker` / `:critic`
- skill: `/team-framework:team`
- SessionStartフックが `worker-critic.mjs` を `~/.claude/workflows/` へ自己同期

> 前提: `~/.claude/settings.json` に `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`（env）が必要。詳細なセットアップ（3層仕分け）は [docs/setup.md](docs/setup.md)。

## 使い方

```
/team-framework:team
```
を**ユーザー自身が入力**して起動（skillはモデルからは起動できない設計）。続けてタスクを伝えると、Orchestrator が分解 → 必要なら Planner → 後半は worker-critic パイプラインで Worker→Critic を回す。

後半パイプラインの起動（Workflowはユーザー明示依頼でのみ走る）:
```
Workflow({ scriptPath: "~/.claude/workflows/worker-critic.mjs", args: <worklist> })
```

worklist の形:
```json
{
  "worktree": false,
  "tasks": [
    { "id": "t1", "scope": "○○を実装", "files": ["src/a.ts"], "model": "sonnet", "deps": [] }
  ]
}
```
- `files` をtasks間で重複させない（並列競合を防ぐ）
- `worktree: true` で Worker を worktree 隔離（スコープ外汚染・並列競合を物理的に防止）
  - **前提①** セッション開始時点でgit repoであること（途中の `git init` は無効）
  - **前提②** リポジトリに最低1コミット（unborn HEAD不可。未コミットなら `git commit --allow-empty -m init`）

## リポジトリ構成

```
team-framework/
├── .claude-plugin/marketplace.json   ← marketplace 定義（koyanagi-plugins）
├── plugins/team-framework/           ← プラグイン本体
│   ├── .claude-plugin/plugin.json
│   ├── agents/                       planner / worker / critic
│   ├── skills/                       team / tool-recover
│   ├── instructions/                 workflow.md / rules.md（O/P/W/C体系）
│   ├── workflows/                    worker-critic.mjs（後半パイプライン）
│   └── hooks/                        hooks.json（SessionStart自己同期）
├── docs/                             setup.md（consumer手順）/ handoff.md（設計・経緯）
├── TEST.md / TEST-phase1.md          検証記録
└── README.md
```

## 開発（ローカル）

編集を即反映したいときは `--plugin-dir` でプラグインサブディレクトリを直接読み込む:
```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --plugin-dir /path/to/team-framework/plugins/team-framework
```

## 設計の詳細

- 設計判断・確定事実・経緯: [docs/handoff.md](docs/handoff.md)
- セットアップ（グローバル/プラグイン/プロジェクトの3層仕分け）: [docs/setup.md](docs/setup.md)
