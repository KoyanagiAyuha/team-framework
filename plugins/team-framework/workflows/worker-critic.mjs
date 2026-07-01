// =============================================================================
// 後半パイプライン: Worker → Critic ゲート（決定論レイヤー）
//
// 役割（機能ベース）:
//   Worker  … 隔離コンテキストで各タスクを並列実装（subagent）
//   Critic  … 各成果物を敵対的に検証。通らないと完了にならない関門（subagent）
//
// この後半は前半（Agent Teams = Orchestrator/Planner/Critic相談）の成果物 "worklist" を入力に取る。
// 動的に分解した worklist を、ここで決定論的に流す ＝「動的にスカウト→決定論パイプライン」。
//
// 実行方法（あなたが明示的に依頼したときだけ起動）:
//   このスクリプトはプラグイン同梱だが、Workflowツールの name 解決は ~/.claude/workflows/ を
//   見ない（実機確認済み）。SessionStartフックがプラグインから ~/.claude/workflows/ へ
//   自己同期するので、起動は scriptPath（同期先の絶対パス）で行う:
//     Workflow({ scriptPath: "~/.claude/workflows/worker-critic.mjs", args: <worklist> })
//
// worklist の形（前半が満たすべき契約）:
//   {
//     worktree: false,             // true かつ git管理下なら Worker を worktree 隔離で実行（スコープ外汚染・並列競合を防ぐ）
//     tasks: [
//       {
//         id:    "t1",                 // 一意ID
//         scope: "○○を実装する",       // やること（スコープ）
//         files: ["src/a.ts"],         // 触るファイル（※tasks間で重複させない＝競合回避）
//         model: "sonnet" | "opus",    // 既定sonnet。複雑実装のみopus
//         deps:  []                    // 依存タスクID（任意）
//       }
//     ]
//   }
// =============================================================================

export const meta = {
  name: 'worker-critic',
  description: 'Worker→Criticゲートの決定論パイプライン（後半）',
  phases: [
    { title: 'Worker', detail: 'Workerが各タスクをスコープ内で並列実装' },
    { title: 'Critic', detail: 'Criticが各成果物を敵対的に検証（合格まで通さない関門）', model: 'fable' },
  ],
}

// 【モデル方針・期間限定】Criticゲートは最も判断が重い関門のため、最上位モデルの Claude Fable 5（エイリアス fable）を割り当てる。
// Fable 5 は期間限定提供。利用不可（輸出管理等で停止）になったら CRITIC_MODEL を 'opus' に戻すこと。
// （agents/critic.md・skills/team/SKILL.md のCritic参照箇所も同時に戻す）
const CRITIC_MODEL = 'fable'

// ---- 入力（args が JSON文字列で届くケースにも対応）----
// 注: 公式docは「argsは構造化データで渡る＝parse不要」とするが、実機(2026-06)では
//     文字列で届くケースを確認済み（diagnostic log: args type=string）。両対応で安全側に倒す。
let worklist = args
if (typeof worklist === 'string') {
  try {
    worklist = JSON.parse(worklist)
  } catch {
    worklist = null
  }
}
worklist = worklist ?? { tasks: [] }
log(`入力: args type=${typeof args} / tasks=${worklist.tasks?.length ?? 0} / worktree=${!!worklist.worktree}`)

if (!worklist.tasks || worklist.tasks.length === 0) {
  log('worklist が空です。前半(Teams)で分解してから args に渡してください。')
  return { passed: [], flagged: [], failed: [], error: 'empty-worklist' }
}

// ---- Worker隔離オプション（git管理下で worktree:true のときだけ発火）----
// worktree隔離はgitリポジトリでのみ機能する。非git環境では付けない（呼び出し側が判断して worktree を渡す）。
// 【前提1：セッション開始時点でgit repoであること】ハーネスのworktree機構はgit判定をセッション開始時に固定する。
//   非gitディレクトリで起動したセッションは、途中で `git init` しても隔離worktreeを作れない
//   （`Cannot create agent worktree: not in a git repository`）。→ git管理下のプロジェクトでセッションを開始すること。
// 【前提2：最低1コミット（unborn HEAD不可）】worktreeは HEAD から分岐するため、コミット0件だと
//   `Failed to resolve base branch "HEAD"` で失敗する。未コミットなら起動前に `git commit --allow-empty -m init`。
//   このスクリプトはサンドボックスでgitを実行できないため、両前提の確認は呼び出し側(Orchestrator/Planner)の責務（skill/planner参照）。
// 【後片付け】変更のある隔離worktreeは自動削除されない。完了後 `git worktree remove <path>` が要る（戻り値 noteで案内）。
const isoOpt = worklist.worktree ? { isolation: 'worktree' } : {}
if (worklist.worktree) {
  log('worktree隔離ON: 前提=①セッション開始時点でgit repo（途中のgit initは無効）②最低1コミット（unborn HEAD不可）。完了後は変更済みworktreeの手動削除が要る場合あり。')
}

// ---- 構造化スキーマ（戻り値を検証付きで受け取る）----
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: '実装内容の要約' },
    outOfScope: { type: 'array', items: { type: 'string' }, description: 'スコープ外で気づいた課題' },
  },
  required: ['taskId', 'summary', 'changedFiles'],
}

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '合格ならtrue' },
    needsRedesign: { type: 'boolean', description: '設計レベルで作り直しが要るならtrue（前半へ差し戻し）' },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' }, description: '問題点と改善案' },
  },
  required: ['ok', 'needsRedesign', 'confidence', 'summary'],
}

// ---- パイプライン: itemごとに「Worker→Critic」を独立して流す（ステージ間バリアなし）----
const results = await pipeline(
  worklist.tasks,

  // ステージ1: Worker
  (task) =>
    agent(
      [
        'あなたは Worker。指示されたスコープ内で最高品質の実装を行い、変更点を返せ。',
        `タスクID: ${task.id}`,
        `スコープ: ${task.scope}`,
        `対象ファイル: ${(task.files || []).join(', ') || '(指定なし)'}`,
        '制約: スコープ外のファイルは作らない・触らない。設計判断が割れる箇所は勝手に決めず outOfScope に記す。',
      ].join('\n'),
      { label: `Worker:${task.id}`, phase: 'Worker', model: task.model || 'sonnet', schema: OUTPUT, ...isoOpt },
    ),

  // ステージ2: Critic ゲート（前ステージ結果 impl と元 task を受け取る）
  (impl, task) =>
    agent(
      [
        'あなたは Critic。実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。',
        '【最重要】Workerの自己申告（要約）を信用するな。変更ファイルを必ず Read し、コードを根拠に判定すること。可能なら実際に実行/テストして挙動で裏取りする。',
        '観点: 機能性 / 既存パターンとの一貫性 / 秘密情報ハードコード等の安全性 / テスト / 型安全性(any禁止) / 過剰設計でないか。',
        '',
        `タスク: ${task.scope}`,
        `変更ファイル（必ず Read して中身を確認）: ${(impl?.changedFiles || []).join(', ') || '(なし＝実装失敗の可能性)'}`,
        `Workerの自己申告（参考。鵜呑みにしない）: ${impl?.summary ?? '(取得不可)'}`,
        '',
        '仕様違反・未処理エッジケース・申告との食い違いがあれば ok=false。設計を作り直すべきなら needsRedesign=true（前半の再計画へ）。issues に具体的根拠（行・実測挙動）を書く。',
      ].join('\n'),
      { label: `Critic:${task.id}`, phase: 'Critic', model: CRITIC_MODEL, schema: VERDICT },
    ).then((verdict) => ({ task, impl, verdict })),
)

// ---- 集約（fan-in）----
const valid = results.filter(Boolean) // 途中で落ちたitemは null になるため除外
const passed = valid.filter((r) => r.verdict?.ok)
const flagged = valid.filter((r) => r.verdict?.needsRedesign) // ← 前半へエスケープ
const failed = valid.filter((r) => !r.verdict?.ok && !r.verdict?.needsRedesign)

log(`合格 ${passed.length} / 要再計画 ${flagged.length} / 不合格 ${failed.length}`)

// worktree:true で全itemが落ちた（valid=0）なら、worktree生成失敗の可能性が高い（unborn HEAD等）。
const droppedAll = !!worklist.worktree && valid.length === 0 && worklist.tasks.length > 0
if (droppedAll) {
  log('⚠ 全タスクが落ちた。worktree隔離の生成失敗の可能性大（リポジトリにコミットが無い=unborn HEAD等）。最低1コミットを作ってから再実行を。')
}

return {
  passed: passed.map((r) => ({ id: r.task.id, summary: r.impl?.summary, files: r.impl?.changedFiles })),
  flagged: flagged.map((r) => ({ id: r.task.id, why: r.verdict?.summary, issues: r.verdict?.issues })),
  failed: failed.map((r) => ({ id: r.task.id, issues: r.verdict?.issues, summary: r.verdict?.summary })),
  // worktree使用時の後片付け案内
  ...(worklist.worktree
    ? { note: '隔離worktreeは変更があると自動削除されない。完了後 `git worktree remove <path>` で掃除すること。' }
    : {}),
  // worktree生成失敗が疑われる場合のヒント
  ...(droppedAll
    ? {
        error: 'worktree-setup-failed?',
        hint: 'worktree隔離の前提を確認: ①セッション開始時点でgit repoであること（非gitで起動したセッションは途中の `git init` を拾わない→git管理下で起動し直す）②最低1コミット（unborn HEADなら `git commit --allow-empty -m init` 後に再実行）。',
      }
    : {}),
}
