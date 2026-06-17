# フェーズ1：本番アセットの通し統合テスト手順

フェーズ0(de-risk)は**スタブ**で検証した。ここではフェーズ1で移植した**本物の agents / skill / workflow** を、installしたプラグインとして通しで動かして実用可能を確定する。
**新規セッションが必須**（プラグインのinstall・新agent type・SessionStartフックは起動済みセッションには効かないため）。

## インストール

```bash
# ローカルディレクトリから読み込んで起動
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --plugin-dir /path/to/team-framework
```

> 既に起動中のセッションで気づいた場合は不可。一度終了して上記で入り直す。

---

## チェックリスト

### ☐ T1: SessionStartフックが「本物」の workflow を自己同期したか
フェーズ0時点では旧スタブ(705B)が `~/.claude/workflows/` に残っていた。本物は **7474B**。

```bash
ls -l ~/.claude/workflows/worker-critic.mjs   # サイズが 7474 前後（≫705）なら本物に更新済み
grep -c "pipeline(" ~/.claude/workflows/worker-critic.mjs   # 1 以上なら本番パイプライン
```

判定: 本物サイズ＋`pipeline(`を含む → **T1 OK**。スタブのまま(705B) → フック未発火、原因調査。

### ☐ T2: skill が名前空間で起動するか
Claude に依頼：

> `/team-framework:team` を起動して。

→ team skill（Orchestrator体制の説明）が起動 → **T2 OK**。

### ☐ T3: 名前空間付き agent type で teammate を spawn できるか（本番agents）
Claude に依頼（**チームメイト**としてspawn。Agentサブエージェントではない）：

> team-framework:planner で Planner を1体 spawn して、簡単な自己紹介と「自分の役割（認知機能）」を述べさせて。

判定:
- planner本人が「重い分解を担当する Planner」である旨を返す → **T3 OK**
- 同様に `team-framework:worker` / `team-framework:critic` も spawn 可なら役者は揃う

### ☐ T4: 後半パイプラインが scriptPath 方式で回るか（Worker→Criticゲート）
テスト用の使い捨て worklist で起動する。Claude に依頼：

> 次の worklist で Workflow を起動して（scriptPath方式）：
> `Workflow({ scriptPath: "~/.claude/workflows/worker-critic.mjs", args: <下記worklist> })`

```json
{
  "worktree": false,
  "tasks": [
    {
      "id": "t1",
      "scope": "./tmp/calc.ts に add(a:number,b:number):number と multiply(a,b):number を実装する",
      "files": ["tmp/calc.ts"],
      "model": "sonnet"
    }
  ]
}
```

判定:
- Worker→Critic の2ステージが流れ、戻り値に `passed / flagged / failed` が入る → **T4 OK**
- `./tmp/calc.ts` が実際に生成され、Criticが**ファイルをReadした根拠**で合否を述べている

### ☐ T5: Critic ゲートの「歯」（嘘の自己申告を見抜くか）＝最重要
わざと**バグを仕込む**タスクを流し、Workerに**「完璧」と自己申告させても** Critic が実コードで見抜くか試す。

> 次の worklist で起動して。Workerには「正しく実装した」と要約させるが、実装には意図的な誤りを残させる：
> tasks: [{ id:"t2", scope:"./tmp/buggy.ts に isEven(n:number):boolean を実装。ただし `return n % 2 === 1` という誤った実装にする", files:["tmp/buggy.ts"], model:"sonnet" }]

判定:
- Critic が `tmp/buggy.ts` を Read／実行裏取りし、**`ok:false`** でロジック誤りを指摘 → **T5 OK（ゲート機能あり）**
- Worker申告を鵜呑みにして `ok:true` を返したら → **T5 NG（ゲートが効いていない＝要修正）**

### ☐ T6: worktree 隔離（git管理下で worktree:true）
スコープ外汚染（過去にWorkerがルートへ package.json 等を作った既知問題）の対策が効くか。
**git repo 内で**（team-framework 自体でも可）`worktree: true` を付けて起動：

> tasks は T4 と同じだが `"worktree": true` を付けて起動して。

判定:
- 実行中・完了後に**プロジェクトルートが汚れていない**（`git status` に想定外の生成物が出ない） → **T6 OK**
- 隔離worktreeが使われたログ／不変なら自動クリーンの挙動を確認

---

## 後片付け
```bash
rm -f ./tmp/calc.ts ./tmp/buggy.ts   # テスト生成物の掃除
git status   # 想定外の残留がないか確認
```

## 結果の記録
T1〜T6 の結果をこのファイル末尾に追記し、本セッションへ報告する。
- 全OK → **プラグイン実用可能を確定**。次は配布導線(GitHub remote / `/plugin` install)へ
- T5 NG → Criticプロンプト/ゲート設計を見直し
- T6 NG → worker-critic.mjs の isolation 分岐を見直し

---

## 結果（実測：2026-06-17）

### T1 SessionStart自己同期（本物）→ **OK**
- `~/.claude/workflows/worker-critic.mjs` = **7474B**（≫705Bスタブ）。`grep -c "pipeline(" ` = **1**。
- SessionStartフックのログ `[team-framework] synced worker-critic.mjs from .../team-framework` も確認。本物に更新済み。

### T2 skill名前空間起動 → **OK（仕様どおり、ただしユーザー起動のみ）**
- skillは名前空間 `team-framework:team` として正しくregist解決された。中身は本物のOrchestrator体制skill（体制図・起動方式・ハイブリッド手順）であることを `skills/team/SKILL.md` で確認。
- ただし frontmatter に `disable-model-invocation: true` があるため、**モデル（Claude）からは起動不可**。`/team-framework:team` をユーザーが入力したときのみ起動する設計。これは意図された挙動。

### T3 名前空間teammate spawn（本番agents）→ **OK**
- `team-framework:planner` / `team-framework:worker` / `team-framework:critic` の3体をすべて**チームメイト**としてspawn成功（Agentサブエージェントではなく、SendMessage可・mailbox経由）。
- 各自が認知機能で自己定義：Planner=「タスク分解・実行計画の立案、自らは実装しない」、Worker=「L1〜L3の実装・調査の実行部隊」、Critic=「実コード・実挙動で裏取りする検証ゲート」。役者は揃った。

### T4 後半パイプライン scriptPath実行 → **OK**
- `Workflow({ scriptPath: "~/.claude/workflows/worker-critic.mjs", args: ... })` でWorker→Criticの2ステージが流れ、戻り値に `passed/flagged/failed` 構造を確認（`passed:[t1]`）。
- `./tmp/calc.ts` が実際に生成（add/multiply 正実装）。サブエージェントtranscriptで Critic が `tmp/calc.ts` を **Read** した証跡を確認 → ファイル根拠で合格判定。

### T5 Criticゲートの歯（最重要）→ **OK（ゲート機能あり）**
- 初回はWorkerが指示に反し正コード（`n % 2 === 0`）を書いたためバグが混入せず**検証不成立**。バグを確実に残す形（バグ入りファイルを先置き＋ロジック変更禁止＋Workerに「正しく動作する」と虚偽申告させる）で再実行。
- Critic は `tmp/buggy.ts` を Read し **`ok:false`（failed）** を返却。実測挙動 `isEven(2)=false / isEven(3)=true / isEven(0)=false` を根拠に論理誤り（`n % 2 === 1`）を指摘し、Workerの自己申告を「実測と矛盾＝虚偽」と明示的に却下。自己申告を鵜呑みにしない関門が効いている。

### T6 worktree隔離 → **OK（前提条件の注意あり）**
- 初回は `Failed to resolve base branch "HEAD"` で即失敗。原因は**test repoにコミットが0件（unborn HEAD）**で、worktreeをHEADから分岐できないため。隔離ロジックのバグではなく前提条件（**git repoに最低1コミット必要**）。
- 空の初期コミットを作成し再実行 → 成果物が `.claude/worktrees/wf_413dfe2e-2ea-1/tmp/calc6.ts` ＝**隔離worktree内**に書かれ、**mainルートに `tmp/calc6.ts` は出現せず**。ルートに想定外生成物（package.json等）なし。スコープ外汚染対策が物理的に機能。
- 注: 変更のある隔離worktreeは自動削除されず残存する（後片付けで `git worktree remove` が必要）。

### 所見 / 次アクション
- **T1〜T6 全OK → プラグイン実用可能を確定**。Critic検証ゲートの「歯」（T5）も実証済み。次は配布導線（GitHub remote / `/plugin` install）へ進めてよい。
- 改善候補1（worker-critic.mjs / skill）: `worktree:true` 時、**コミットの無いrepo（unborn HEAD）を事前検出**し、分かりやすいエラー or 自動で空コミットへフォールバックすると親切（T6の初回失敗を回避できる）。
- 改善候補2（運用）: 変更済み隔離worktreeは残存するため、Workflow側でクリーンアップ手順／案内を持たせると後片付けが楽。
- 検証手順の学び（T5）: 「Workerにバグを書かせる」指示はWorkerが善意で正しく直してしまうことがある。ゲートの歯を試すなら**バグ入りファイルを先置きし、ロジック変更を禁じる**のが確実。
- 後片付け済み: 隔離worktree除去・`tmp/` 内テスト生成物削除・`.claude/worktrees` 削除。**唯一 T6用の空コミット `1af6a6b` のみ残置**（元はコミット0件。削除（unborn復帰）はユーザー確認待ち）。
