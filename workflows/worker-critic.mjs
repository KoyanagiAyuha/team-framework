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
    { title: 'Critic', detail: 'Criticが各成果物を敵対的に検証（合格まで通さない関門）' },
  ],
}

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
const isoOpt = worklist.worktree ? { isolation: 'worktree' } : {}

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
      { label: `Critic:${task.id}`, phase: 'Critic', schema: VERDICT },
    ).then((verdict) => ({ task, impl, verdict })),
)

// ---- 集約（fan-in）----
const valid = results.filter(Boolean) // 途中で落ちたitemは null になるため除外
const passed = valid.filter((r) => r.verdict?.ok)
const flagged = valid.filter((r) => r.verdict?.needsRedesign) // ← 前半へエスケープ
const failed = valid.filter((r) => !r.verdict?.ok && !r.verdict?.needsRedesign)

log(`合格 ${passed.length} / 要再計画 ${flagged.length} / 不合格 ${failed.length}`)

return {
  passed: passed.map((r) => ({ id: r.task.id, summary: r.impl?.summary, files: r.impl?.changedFiles })),
  flagged: flagged.map((r) => ({ id: r.task.id, why: r.verdict?.summary, issues: r.verdict?.issues })),
  failed: failed.map((r) => ({ id: r.task.id, issues: r.verdict?.issues, summary: r.verdict?.summary })),
}
