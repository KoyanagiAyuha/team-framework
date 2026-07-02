// =============================================================================
// 後半パイプライン: Worker → 機械収集 → Critic ゲート（決定論レイヤー）
//
// 役割（機能ベース）:
//   Worker   … 隔離コンテキストで各タスクを並列実装（subagent）
//   収集役   … 判断ゼロ。テスト/tsc を実行し「証拠」を機械的に集めて圧縮する（sonnet固定）
//   Critic   … 各成果物を敵対的に検証。通らないと完了にならない関門（fable）
//
// この後半は前半（Agent Teams = Orchestrator/Planner/Critic相談）の成果物 "worklist" を入力に取る。
// 動的に分解した worklist を、ここで決定論的に流す ＝「動的にスカウト→決定論パイプライン」。
//
// 【設計方針・なぜ収集役を挟むか】
//   トークン爆発の主因は「コード」ではなく「テスト/tsc の生出力」であることが多い（失敗ビルドの
//   連鎖エラー・verboseログ・スタックトレースは容易にコードの5〜10倍になる）。生出力は fable の
//   判断を要さないので、判断ゼロの収集役（sonnet）が exit code＋失敗抜粋に圧縮してから Critic に渡す。
//   コード自体は「全部読まないと検証できない下限」なので Critic が自分で Read する（新規開発中心では
//   diff ≒ 全文＝節約余地がないため、diff方式は採らずコードは素直に Read させる）。
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
//         criticModel: "fable",        // 任意。検証モデルの明示上書き（省略時は fable）。※per-task階層化の予約フィールド
//         deps:  []                    // 依存タスクID（任意）
//       }
//     ]
//   }
// =============================================================================

export const meta = {
  name: 'worker-critic',
  description: 'Worker→機械収集→Critic判定の決定論パイプライン（後半）',
  phases: [
    { title: 'Worker', detail: 'Workerが各タスクをスコープ内で並列実装' },
    { title: 'Collect', detail: '収集役がテスト/tscを実行し証拠を機械的に圧縮（判断ゼロ）', model: 'sonnet' },
    { title: 'Critic', detail: 'Criticが各成果物を敵対的に検証（合格まで通さない関門）', model: 'fable' },
  ],
}

// 【モデル方針・期間限定】Criticゲートは最も判断が重い関門のため、最上位モデルの Claude Fable 5（エイリアス fable）を割り当てる。
// Fable 5 は期間限定提供。利用不可（輸出管理等で停止）になったら CRITIC_MODEL を 'opus' に戻すこと。
// （agents/critic.md・agents/planner.md・skills/team/SKILL.md のCritic参照箇所も同時に戻す）
const CRITIC_MODEL = 'fable'

// 収集役は判断ゼロのシェル作業なので最も安いモデル・低effortで固定する（判定はしない）。
const COLLECTOR_MODEL = 'sonnet'

// 粒度ガードレール（②）。1タスクの新規/変更行がこれを超えたら「fableで読む前に」前半へ差し戻す。
// 読解下限は分割でしか下げられないため、上限超過はゲート設計でなく分解粒度の問題として背圧をかける。
// 実測で調整する前提の初期値。
const MAX_NEW_LINES = 600

// 失敗ログ抜粋の上限（収集役の圧縮が暴走してもコード側で防御的に切る）。
const MAX_FAILURE_EXCERPT = 2000 // 1コマンドあたりの文字数
const MAX_EVIDENCE_CHARS = 8000 // 全テスト証拠の合計文字数の目安

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
//
// 【重要・worktree時の証拠参照先】Worker は自分専用の隔離worktree内で変更する。後続の収集役・Critic は
//   隔離を付けず（＝別worktreeを新規作成しないよう isoOpt を渡さない）、Worker が申告した worktreeRoot を
//   作業ディレクトリとして `git -C <worktreeRoot> ...` で証拠を取り、その配下の絶対パスをReadする。
//   （旧実装は Critic に worktreeRoot を渡しておらず、本体ツリーの未変更ファイルを読んでいた＝v0.2.0のバグ）。
const isoOpt = worklist.worktree ? { isolation: 'worktree' } : {}
if (worklist.worktree) {
  log('worktree隔離ON: 前提=①セッション開始時点でgit repo（途中のgit initは無効）②最低1コミット（unborn HEAD不可）。収集役/Criticは worktreeRoot 配下で証拠取得。完了後は変更済みworktreeの手動削除が要る場合あり。')
}

// ---- 構造化スキーマ ----
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    worktreeRoot: { type: 'string', description: 'worktree隔離時に実際に作業した作業ツリーの絶対パス（`git rev-parse --show-toplevel`）。非隔離なら空文字でよい' },
    summary: { type: 'string', description: '実装内容の要約' },
    outOfScope: { type: 'array', items: { type: 'string' }, description: 'スコープ外で気づいた課題' },
  },
  required: ['taskId', 'summary', 'changedFiles'],
}

// 収集役の証拠。判断（合否）は一切含めない。テスト/tsc の生出力を exit code＋失敗抜粋に圧縮する。
const EVIDENCE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    taskId: { type: 'string' },
    actualChangedFiles: { type: 'array', items: { type: 'string' }, description: 'git status 由来の実際に変更/追加されたファイル' },
    scopeViolations: { type: 'array', items: { type: 'string' }, description: 'task.files に無いのに変更されたファイル（スコープ違反の疑い）' },
    totalNewLines: { type: 'integer', description: '変更ファイルの追加/新規行の合計（新規ファイルは全行）。粒度判定に使う' },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'integer', description: '生値。0=成功。圧縮で歪めないこと' },
          failureExcerpt: { type: 'string', description: '失敗時のみ。関連する失敗箇所の抜粋（成功時は空）' },
        },
        required: ['command', 'exitCode'],
      },
      description: '実行したテスト/型検査/ビルドの結果。生出力は流さず圧縮する',
    },
  },
  required: ['taskId', 'actualChangedFiles', 'totalNewLines', 'tests'],
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

// worktreeRoot 配下で作業させる共通指示（非隔離なら現在のリポジトリで作業）。
const rootHint = (root) =>
  root
    ? `作業ディレクトリ: ${root}（隔離worktree）。git は \`git -C ${root} ...\` で実行し、ファイルReadもこの配下の絶対パスで行うこと。`
    : '作業ディレクトリ: 現在のリポジトリ（隔離なし）。'

// ---- パイプライン: itemごとに「Worker→収集→Critic」を独立して流す（ステージ間バリアなし）----
const results = await pipeline(
  worklist.tasks,

  // ステージ1: Worker（実装）
  (task) =>
    agent(
      [
        'あなたは Worker。指示されたスコープ内で最高品質の実装を行い、変更点を返せ。',
        `タスクID: ${task.id}`,
        `スコープ: ${task.scope}`,
        `対象ファイル: ${(task.files || []).join(', ') || '(指定なし)'}`,
        '制約: スコープ外のファイルは作らない・触らない。設計判断が割れる箇所は勝手に決めず outOfScope に記す。',
        worklist.worktree
          ? '完了後 `git rev-parse --show-toplevel` を実行し、その絶対パスを worktreeRoot に必ず入れること（後続の検証がこのツリーを読む）。'
          : 'worktreeRoot は空文字でよい。',
      ].join('\n'),
      { label: `Worker:${task.id}`, phase: 'Worker', model: task.model || 'sonnet', schema: OUTPUT, ...isoOpt },
    ),

  // ステージ2: 機械収集（判断ゼロ・sonnet固定）。テスト/tsc を実行し圧縮して証拠化する。
  (impl, task) => {
    if (!impl) return null // Worker が落ちた item はここで終了
    const root = impl.worktreeRoot || ''
    return agent(
      [
        'あなたは収集役。合否判定は一切しない。指示されたコマンドを実行し、結果を機械的に圧縮して返すだけ。',
        rootHint(root),
        `タスクID: ${task.id}`,
        `Workerが変更したと申告したファイル: ${(impl.changedFiles || []).join(', ') || '(なし)'}`,
        `スコープとして許可されたファイル: ${(task.files || []).join(', ') || '(指定なし)'}`,
        '',
        'やること（判断せず機械的に）:',
        '1. `git status --porcelain` で実際に変更/追加されたファイルを列挙し actualChangedFiles に入れる。task.files に無いものは scopeViolations にも入れる。',
        '   ※ status がクリーンなのに Worker が変更を報告している場合は、Worker がコミットしてしまった可能性。`git log --oneline -5` を見て base からのコミットがあれば、その差分（`git diff <base>..HEAD --numstat` 等）で actualChangedFiles / totalNewLines を拾うこと。',
        '2. 変更/新規ファイルの追加行合計を totalNewLines に入れる（新規ファイルは全行。`git diff --numstat` や `wc -l` を使う。新規で未追跡なら `git add -N` 後に numstat、または `wc -l`）。',
        '3. プロジェクトの型検査とテストを実行する（package.jsonのscripts等から判断。例: tsc --noEmit、npm test、pytest 等。無ければ実行不要）。',
        '4. 各コマンドについて command と exitCode（生値。0=成功）を記録する。失敗（exit≠0）のときだけ failureExcerpt に「関連する失敗箇所」を抜粋する。',
        '',
        `圧縮ルール: 生出力を丸ごと入れるな。failureExcerpt は1コマンド ${MAX_FAILURE_EXCERPT} 文字以内、失敗の核心（エラー行・失敗アサーション）に絞る。成功したコマンドの出力は入れない（exitCode=0だけで十分）。`,
        'exitCode は絶対に生値を通すこと（要約で歪めない）。',
      ].join('\n'),
      { label: `Collect:${task.id}`, phase: 'Collect', model: COLLECTOR_MODEL, effort: 'low', schema: EVIDENCE },
    ).then((evidence) => ({ impl, evidence }))
  },

  // ステージ3: Critic ゲート（前ステージの {impl, evidence} と元 task を受け取る）
  (prev, task) => {
    if (!prev || !prev.impl) return null // 前段が落ちた item は終了
    const { impl, evidence } = prev

    // 粒度背圧（②）: 検証対象が上限超過なら、fable を呼ぶ前にコード側で差し戻す（トークンも節約）。
    if (evidence && typeof evidence.totalNewLines === 'number' && evidence.totalNewLines > MAX_NEW_LINES) {
      const verdict = {
        ok: false,
        needsRedesign: true,
        confidence: '高',
        summary: `検証対象が ${evidence.totalNewLines} 行で上限 ${MAX_NEW_LINES} 行を超過。1回のレビューで検証しきれない粒度のため、前半でタスクを分割して再計画すること。`,
        issues: [`totalNewLines=${evidence.totalNewLines} > MAX_NEW_LINES=${MAX_NEW_LINES}。粒度が検証可能な大きさを超えている（ゲートの問題ではなく分解粒度の問題）。`],
      }
      return { task, impl, evidence, verdict }
    }

    // 証拠のテスト結果を Critic 向けに整形（生出力は既に収集役が圧縮済み。ここでも合計上限で防御的に切る）。
    let evidenceText = (evidence?.tests || [])
      .map((t) => `- \`${t.command}\` → exit ${t.exitCode}${t.exitCode !== 0 && t.failureExcerpt ? `\n  失敗抜粋:\n${t.failureExcerpt}` : ''}`)
      .join('\n')
    if (evidenceText.length > MAX_EVIDENCE_CHARS) evidenceText = evidenceText.slice(0, MAX_EVIDENCE_CHARS) + '\n…(証拠が長いため切り捨て)'
    const scopeNote = evidence?.scopeViolations?.length
      ? `⚠ スコープ違反の疑い（許可外ファイルの変更）: ${evidence.scopeViolations.join(', ')}`
      : ''
    // 収集役が落ちた（evidence=null）ケースと、収集役は動いたがテストが無いケースを区別する。
    // 前者を「テスト実行なし」と誤認すると、未検証のまま合格を出しかねない。
    const evidenceBlock = !evidence
      ? '⚠ 収集役の証拠が取得できなかった（収集役が失敗した可能性）。テスト/型検査の結果は不明。的を絞った確認を自分で最小限実行し、確証が持てなければ confidence を下げること。'
      : evidenceText || '(テスト/型検査の実行なし＝該当コマンドが見つからなかった)'

    return agent(
      [
        'あなたは Critic。実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。',
        rootHint(impl.worktreeRoot || ''),
        '【最重要】Workerの自己申告（要約）を信用するな。変更ファイルを必ず Read し、コードを根拠に判定すること。',
        '【テストは再実行しない】テスト/型検査は収集役が実行済み（下記の証拠を使う）。フルスイートの再実行はするな。文脈上どうしても要る場合のみ、的を絞ったコマンドを `| tail -40` 等のフィルタ付きで最小限実行してよい。',
        '観点: 機能性 / 既存パターンとの一貫性 / 秘密情報ハードコード等の安全性 / テスト / 型安全性(any禁止) / 過剰設計でないか。',
        '',
        `タスク: ${task.scope}`,
        `変更ファイル（必ず Read して中身を確認）: ${(impl?.changedFiles || []).join(', ') || '(なし＝実装失敗の可能性)'}`,
        `Workerの自己申告（参考。鵜呑みにしない）: ${impl?.summary ?? '(取得不可)'}`,
        scopeNote,
        '',
        '収集役が集めた証拠（テスト/型検査。exitCodeは生値）:',
        evidenceBlock,
        '',
        '仕様違反・未処理エッジケース・申告との食い違い・テスト失敗(exit≠0)があれば ok=false。設計を作り直すべきなら needsRedesign=true（前半の再計画へ）。issues に具体的根拠（行・実測挙動）を書く。',
      ]
        .filter(Boolean)
        .join('\n'),
      { label: `Critic:${task.id}`, phase: 'Critic', model: task.criticModel || CRITIC_MODEL, schema: VERDICT },
    ).then((verdict) => ({ task, impl, evidence, verdict }))
  },
)

// ---- 集約（fan-in）----
const valid = results.filter(Boolean) // 途中で落ちたitemは null になるため除外
// 排他分類（needsRedesign を最優先で拾い、passed/flagged/failed が重複しないようにする）
const flagged = valid.filter((r) => r.verdict?.needsRedesign) // ← 前半へエスケープ
const passed = valid.filter((r) => r.verdict?.ok && !r.verdict?.needsRedesign)
const failed = valid.filter((r) => !r.verdict?.ok && !r.verdict?.needsRedesign)

log(`合格 ${passed.length} / 要再計画 ${flagged.length} / 不合格 ${failed.length}`)

// worktree:true で全itemが落ちた（valid=0）なら、worktree生成失敗の可能性が高い（unborn HEAD等）。
const droppedAll = !!worklist.worktree && valid.length === 0 && worklist.tasks.length > 0
if (droppedAll) {
  log('⚠ 全タスクが落ちた。worktree隔離の生成失敗の可能性大（リポジトリにコミットが無い=unborn HEAD等）。最低1コミットを作ってから再実行を。')
}

// worktree:true 時、合格itemの成果コードは隔離worktree内にしか無い。Orchestratorが「どのツリーから
// 変更を取り込む／掃除する」かを判断できるよう、item に worktreeRoot を含める（非worktree時は付けない）。
const wt = (r) => (worklist.worktree ? { worktreeRoot: r.impl?.worktreeRoot } : {})

return {
  // confidence を全itemに露出する（SKILL.mdのエスケープ弁「confidence=低なら前半へ戻す」を実装可能にする）。
  passed: passed.map((r) => ({ id: r.task.id, summary: r.impl?.summary, files: r.impl?.changedFiles, confidence: r.verdict?.confidence, ...wt(r) })),
  flagged: flagged.map((r) => ({ id: r.task.id, why: r.verdict?.summary, issues: r.verdict?.issues, confidence: r.verdict?.confidence, ...wt(r) })),
  failed: failed.map((r) => ({ id: r.task.id, issues: r.verdict?.issues, summary: r.verdict?.summary, confidence: r.verdict?.confidence, ...wt(r) })),
  // worktree使用時の後片付け案内
  ...(worklist.worktree
    ? { note: '隔離worktreeは変更があると自動削除されない。各itemの worktreeRoot から変更を回収し、完了後 `git worktree remove <worktreeRoot>` で掃除すること。' }
    : {}),
  // worktree生成失敗が疑われる場合のヒント
  ...(droppedAll
    ? {
        error: 'worktree-setup-failed?',
        hint: 'worktree隔離の前提を確認: ①セッション開始時点でgit repoであること（非gitで起動したセッションは途中の `git init` を拾わない→git管理下で起動し直す）②最低1コミット（unborn HEADなら `git commit --allow-empty -m init` 後に再実行）。',
      }
    : {}),
}
