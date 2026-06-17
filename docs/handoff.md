# 引き継ぎ（次セッション用）

> **開発ホーム＝このリポジトリ `team-framework/`（git化済み・配布プラグイン）。** 2026-06-17 に旧プロジェクト `部長、課長、平社員、顧問/` から移行。旧側は**移行元として温存**（旧`.claude/`の中身をフェーズ1でここへ移植する）。

> このプロジェクトは「`.claude` を汎用マルチエージェント基盤として育て、他プロジェクトでも使えるようにする」取り組み。HRメタファ（部長/課長…）を捨て、**関数ベース × ハイブリッド**に作り替えた。

## 確定した設計（議論で合意済み）

- **役割は肩書きでなく認知機能で定義**。人間＝**エンジニア（外部オペレーター／human-in-the-loop。階層の頂点ではない）**。エージェントは **Orchestrator（main session）／Planner／Worker／Critic**。
- **ハイブリッド構成**: 前半（理解・分解・設計相談）＝動的な **Agent Teams**、後半（実装・検証）＝決定論的な **Workflow**。
- **Planner は重い分解のときだけ**立てる（軽い分解は Orchestrator が兼ねる）。段はコンテキスト隔離が正当化するときだけ足す。
- **Critic ゲートが肝**: 自己申告（要約）を信用せず、**実コードを Read ＋可能なら実行して裏取り**。通らないと完了にしない。
- 軸の整理: 軸1＝役割定義（関数ベース採用）、軸2＝制御フロー（前半=動的ルーティング／後半=決定論グラフ）。Teams=動的側、Workflow=決定論側。

## 完了済み（実装・検証ともDONE）

- `.claude/agents/`: **planner.md / worker.md / critic.md**（英語名）。旧 kacho/komon/tantousha および keikaku/jissou/kenshou は削除済み。
- `.claude/workflows/worker-critic.mjs`: 後半パイプライン（Worker→Criticゲート）。args文字列対策のJSON.parseガード入り、Criticは実ファイルRead必須。
- ドキュメント全更新: `CLAUDE.md` / `skills/team/SKILL.md` / `instructions/workflow.md` / `instructions/rules.md`（禁止行為コードを **O/P/W/C** 体系に）/ `status/dashboard.md` / `skills/tool-recover/SKILL.md`。
- **陳腐化修正**（v2.1.178準拠）: `TeamCreate`/`TeamDelete` 廃止 → 最初のteammate spawnでチーム自動成立。**cleanupはセッション終了時に自動**（手動不要）。B-007→O-007。
- **テスト済み**:
  - 後半ゲートの実力テスト（仕込みバグ＋嘘の自己申告）→ Criticが実行裏取りで全部見抜いた。
  - 通しテスト（前半Teams＋後半Workflow）→ Planner が worklist 生成 → worker-critic.mjs 実行 → **Criticが“仕込みなし”で型検査(tsc)失敗を検出しブロック**（runtime pass ≠ 型安全 を捕捉）。独立にvitest/tscを回して確認済み。
- grep検証: 旧識別子・旧役職名・旧コードの残存ゼロ。

## 技術的な落とし穴（重要メモ）

- **Workflowの `args` はこの環境では文字列で届く**（公式docは「構造化データ＝parse不要」と言うが実機は string）。→ スクリプト側のJSON.parseガードは必須。
- **Workflowツールはユーザーの明示依頼でのみ起動**（勝手に走らせない）。
- **新agent typeは新規セッションから有効**。
- **スコープ逸脱の既知問題**: 通しテストで Worker が `package.json`/`tsconfig.json` を**プロジェクトルートに作成**（スコープ外汚染）。→ フェーズ1で **worktree隔離（`worktree:true`）を worker-critic.mjs に組込み済み**・T6で機能確認。
- **worktree隔離の2前提（実測で確定）**: ①**セッション開始時点でgit repoであること**（ハーネスがgit判定をセッション開始時に固定するため、途中の `git init` は拾われず `Cannot create agent worktree...` で失敗）、②**最低1コミット**（unborn HEADだと `Failed to resolve base branch "HEAD"`）。両前提は worker-critic.mjs のログ/失敗ヒント＋skill/plannerに明記済み（`5695de7`）。

## 次にやること（＝グローバル/プラグイン化。着手済み・フェーズ0準備完了）

**「毎回コピー面倒／汎用すぎ」問題の解決。配布先＝他人・他マシン と確定 → プラグイン主軸（道B）で進行中。**

### 確定した方針（このセッションで合意）
- 配布主軸＝**プラグイン**（バージョン付き・`/plugin`で一括install）。グローバルは「個人設定スライス」だけ。
- 仕分け:
  - **グローバル `~/.claude/settings.json`**: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` / `attribution`（署名なし）/ 普遍permission（`uv`,`mkdir`）
  - **プラグイン `team-framework/`**: agents / skills（team・tool-recover）/ instructions / workflow。SKILL本体を自己完結化し12KB CLAUDE.mdを溶かす
  - **プロジェクトローカル `.claude/`**: dashboard（実行時生成）/ ドメインpermission（`Bash(snow *)`）/ 薄いCLAUDE.md

### 裏取りで確定した制約（claude-code-guideで検証済み）
- **A**: `${CLAUDE_PLUGIN_ROOT}` は **skill本文では展開されない**（hooks/MCP/LSP/monitorsのJSONのみ）。→ workflowはプラグイン同梱scriptPath参照は不可。**解決策＝SessionStartフックで `~/.claude/workflows/` に自己同期**し `Workflow({name})` で名前解決（フックのcommand文字列なら`${CLAUDE_PLUGIN_ROOT}`が効く）。
- **B**: プラグインのagent/skillは**名前空間必須**（`team-framework:planner` / `/team-framework:team`）。bare名では解決しない。teammateとして使えるとは公式に明記あるが、**名前空間付き名でのteammate spawn解決は未文書 → 実測が必要**。

### フェーズ計画と進捗
- **フェーズ0（de-risk）= ✅ 完了**: 実測結果は `TEST.md` 末尾に記録。**A-2＝NG（workflowはname解決不可→scriptPath方式に確定）／B＝OK（名前空間teammate spawn可）／C＝OK（`/team-framework:team`）**。コミット `aa96e5f`。
- **フェーズ1（本移行）= ✅ 完了（コミット `d923102`）**: agents（planner/worker/critic）/ skills（team/tool-recover）/ instructions（workflow/rules）/ workflow をプラグインへ移植。**scriptPath方式・worktree隔離・名前空間**すべて反映。SessionStart自己同期フック稼働。
- **フェーズ2（仕分け）= 🔄 進行中**:
  - 層1 グローバル `~/.claude/settings.json` ＝ ほぼ完成（Teams有効化/attribution/普遍permission 投入済み）。**`Bash(snow:*)` はドメイン固有なので層1から削除済み**（→ snow利用プロジェクトの層3 `.claude/settings.json` へ移す運用）。
  - 層2 プラグイン ＝ フェーズ1で完了。
  - 層3 プロジェクトローカル ＝ 各consumerプロジェクトで都度（dashboard/ドメインpermission/薄いCLAUDE.md）。手順は `docs/setup.md` に記載。

### 成果物の場所
- 検証プラグイン: `/Users/ayuhakoyanagi/Desktop/workspace/team-framework/`（手順は同ディレクトリ `TEST.md`）
- 移行元の現行実装: 本プロジェクト `.claude/`（agents/skills/workflows/instructions/CLAUDE.md）

データ系などの特化は「骨組みを1つ維持し、Worker層だけ専門化（例 worker-data）」で対応。骨組みを丸ごとフォークしない。

### worktree隔離（フェーズ1で組込み）
後半Workerのスコープ安全のため `agent(..., { isolation: 'worktree' })` を worker-critic.mjs に組込む。置き場所はグローバル側（フレームワーク本体）、発火はgit repoのときだけ条件分岐。

### 任意・優先度低
- 後半Workerの worktree 隔離（スコープ安全）。
- ワークスペースのフォルダ名「部長、課長、平社員、顧問」のリネーム（見た目だけ・パス/git影響ありなので要相談）。

## プロセス注意
- このセッションは**ツール呼び出しのテキスト化（`count`/`<invoke>`）が約6回再発**したため切り替え推奨に至った。次セッションでEditが壊れたら **Bash(perl/sed)で代替**すると確実。
