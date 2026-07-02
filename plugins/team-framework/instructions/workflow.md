# ワークフローと通信規約（Agent Teams ＋ Workflow）

役割は機能で定義される：**エンジニア（人間）／Orchestrator／Planner/Worker/Critic**。前半は動的なTeams、後半は決定論的なWorkflowで回す。

> プラグイン提供のため、agent type は名前空間付き（`team-framework:planner` / `team-framework:worker` / `team-framework:critic`）で参照する。skill 起動名は `/team-framework:team`。

## 標準ワークフロー

### Phase 0: 受命と判断

```
エンジニアが指示を出す
  │
  ▼
Orchestratorが要求を分析
  ├── 要件が明確 → Phase 1へ
  ├── 要件が曖昧 → エンジニアに確認してからPhase 1へ
  └── 設計判断が必要 → Criticチームメイトに相談してからPhase 1へ
```

### Phase 1: チーム起動とタスク分解（前半・動的）

1. 軽い分解ならOrchestratorが自分で行う。重い／多フェーズならOrchestratorが `team-framework:planner` チームメイトをspawnし、タスク内容と背景を伝える
2. Plannerがタスクをフェーズ・依存関係・担当・モデルに分解する
3. Plannerが共有タスクリストにタスクを登録し、**worklist（構造化）**を用意する
4. Plannerが `team-framework:worker` チームメイトにSendMessageで直接指示する

### Phase 2: 並列実行

- 独立タスクは複数の `team-framework:worker` チームメイトを同時にspawnして並列実行
- Plannerが各WorkerにSendMessageで直接タスクを割り当てる
- Workerは設計判断が必要になれば `team-framework:critic` チームメイトにSendMessageで直接相談する
- 依存関係のあるタスクは前フェーズ完了後に次のチームメイトをspawn
- **後半を決定論で固める場合**: Orchestratorが worklist を args に渡し、`Workflow({ scriptPath })` で worker-critic.mjs を起動して `Worker → Criticゲート` のパイプラインで回す（起動の詳細は team skill 参照）

### Phase 3: 品質確認（検証ゲート）

| 変更規模 | レビュー方法 |
|----------|------------|
| 1ファイル・軽微な変更 | Orchestratorが目視確認 |
| 複数ファイル・ロジック変更 | **後半パイプラインの検証ゲート**（Worker→収集→Critic）で検証する |
| アーキテクチャ変更 | 検証ゲート＋エンジニア承認 |

> **実装後のフルレビューは検証ゲートに一本化する。** Teamsチームメイトとしての Critic は「着手前の設計相談（L4–L6）」が職掌で、実装後の成果物フルレビューを個別に引き受けない（fableトークンの二重消費を防ぐ）。
>
> ゲートの中身（`worker-critic.mjs`）は3段: **① Worker が実装 → ② 収集役（sonnet・判断ゼロ）がテスト/tsc を実行し exit code＋失敗抜粋に圧縮 → ③ Critic（fable）がコードを Read し、②の証拠を使って合否判定**。テストの再実行はしない（②の証拠を使う）。1タスクの検証対象が上限（目安600行）を超えると、Critic を呼ぶ前に `needsRedesign` で前半へ差し戻す（粒度の背圧）。Criticは自己申告（要約）だけで合格させない。設計から作り直すべきなら `needsRedesign` を立て、Orchestratorが前半に戻して再計画する。

### Phase 4: 集約と報告

1. Orchestratorが各チームメイト／パイプラインの結果を集約する
2. dashboard.mdを更新する
3. エンジニアに完了報告する

```
## 完了報告
- 概要: {何をしたか 1-2文}
- 実行タスク: {タスク一覧と結果}
- 変更ファイル: {パス一覧}
- 注意事項: {エンジニアが知るべきこと}
- 残課題: {あれば}
```

## 並列実行パターン

### パターン1: 完全並列（Fan-out / Fan-in）

独立した複数タスクを同時に実行し、全結果を統合する。

```
Orchestrator → Planner（計画・タスクリスト登録）
            │
            ├─ Worker A（ファイルX実装）← SendMessage
            ├─ Worker B（ファイルY実装）← SendMessage
            └─ Worker C（ファイルZ実装）← SendMessage
                       │
                   全員完了通知
                       │
                   Orchestratorが結果集約
```

### パターン2: パイプライン（逐次チェーン）

前のタスクの結果が次のタスクの入力になる場合。後半の決定論パイプライン（`worker-critic.mjs`）はこの形をコードで固定したもの。

```
Worker（実装）→ SendMessage → Critic（レビュー）→ SendMessage → Worker（修正）
```

### パターン3: ハイブリッド

フェーズ内は並列、フェーズ間は逐次。前半（動的Teams）→後半（決定論Workflow）もこの形。

```
[Phase 1: 並列調査]           [Phase 2: 設計]      [Phase 3: 並列実装＋検証ゲート]
 Worker A（調査X）  ─→                            → Worker A（実装X）→ Critic
 Worker B（調査Y）  ─→  Critic（設計判断）        → Worker B（実装Y）→ Critic
 Worker C（調査Z）  ─→                            → Worker C（実装Z）→ Critic
```

## コンテキスト管理

### 長期プロジェクトでの対策

複数フェーズにわたる場合、Orchestratorは `.workflow/` ディレクトリを作成して情報を永続化する：

- **`.workflow/context.md`**: プロジェクトの背景・要件・制約
- **`.workflow/decisions.md`**: 判断ログ（「なぜこうしたか」の記録）
- **`.workflow/current-state.md`**: 現在の進捗スナップショット

`.workflow/` は作業用の一時ディレクトリ。`.gitignore` への追加を推奨。

### チームメイトへのコンテキスト伝達

spawn時のプロンプトに含める情報の優先度：

1. **最重要**: タスク内容・スコープ・制約
2. **必要に応じて**: 「{パス}を読んでから作業してください」
3. **省略**: チームメイトに不要な情報（トークン節約）
