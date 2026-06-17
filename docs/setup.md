# セットアップ手順（consumer 向け）

team-framework を**別プロジェクト／別マシン**で使うための手順。設計は「変更頻度と共有範囲で3層に分ける」考え方（→ `docs/handoff.md` の仕分け設計）。

## 3層の役割（要約）

| 層 | 置き場所 | 中身 | 判断基準 |
|---|---|---|---|
| 層1 グローバル | `~/.claude/settings.json` | Teams有効化 / attribution / 普遍permission / 個人設定 | このマシンの"あなた"なら常に真 |
| 層2 プラグイン | team-framework（install物） | agents / skills / instructions / workflows / hooks | 他人・他マシンに配って同じく動くべきもの |
| 層3 プロジェクトローカル | 各プロジェクト `.claude/` | dashboard / ドメインpermission / 薄いCLAUDE.md | このプロジェクトだけで真 |

## 手順

### 1. グローバル（初回・マシンごとに1回）

`~/.claude/settings.json` に普遍スライスを置く（最小例）:

```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "attribution": { "commit": "", "pr": "" },
  "permissions": {
    "allow": ["Bash(uv:*)", "Bash(mkdir:*)", "Bash(git add:*)", "Bash(git commit:*)"]
  }
}
```

> ドメイン固有permission（例 `Bash(snow:*)`）はここに置かない。層3へ。

### 2. プラグインのinstall（フレームワーク本体）

```bash
# 起動時にローカルディレクトリから読み込む
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --plugin-dir /path/to/team-framework

# または起動中に /plugin メニューからローカル追加 → /reload-plugins
```

install されると以下が名前空間付きで使える:
- agent type: `team-framework:planner` / `team-framework:worker` / `team-framework:critic`
- skill: `/team-framework:team`
- SessionStartフックが `~/.claude/workflows/worker-critic.mjs` へ自己同期

### 3. プロジェクトローカル（プロジェクトごと）

そのプロジェクトの `.claude/` に固有分だけ置く:

```
.claude/
├── settings.json      # ドメインpermission（例 "Bash(snow:*)"）
└── CLAUDE.md          # プロジェクト固有コンテキストのみ（薄く）
```

フレームワーク本体（役割定義・ルール・workflow）は層2が供給するので、巨大な CLAUDE.md は不要。

## 起動

```
/team-framework:team   # Orchestrator として体制起動
```

後半の決定論パイプラインは **scriptPath 方式**で呼ぶ（name 解決は不可・実機確認済み）:

```
Workflow({ scriptPath: "~/.claude/workflows/worker-critic.mjs", args: <worklist> })
```

git管理下のプロジェクトでは worklist に `"worktree": true` を付けると Worker を worktree 隔離で走らせ、スコープ外汚染・並列競合を防げる。
