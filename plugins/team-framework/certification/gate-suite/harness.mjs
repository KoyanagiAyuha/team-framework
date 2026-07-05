export const meta = {
  name: 'fable-skill-trap-suite',
  description: '非cueトラップ課題で opus素 vs opus+skillA の MISS抑止力と特異度(clean)を実測',
  phases: [{ title: 'solo' }, { title: 'skill' }],
}

// args = { skillA: "<skill A 全文>", packets: [{id:"T1", text:"..."}, ...], runs: 3 }
const A = typeof args === 'string' ? JSON.parse(args) : (args || {})
const { skillA, packets, runs = 3 } = A
if (!skillA || !Array.isArray(packets) || packets.length === 0) {
  return { error: 'args未受領', got: { skillA: !!skillA, packets: Array.isArray(packets) ? packets.length : typeof packets } }
}

const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: 'true=APPROVE / false=REQUEST_CHANGES' },
    confidence: { type: 'string', enum: ['高', '中', '低'] },
    needsRedesign: { type: 'boolean' },
    issues: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['ok', 'confidence', 'needsRedesign', 'issues', 'summary'],
}

// 被験ゲートはリポジトリを一切探索してはならない（ANSWER-KEY等のリーク防止）。
const NO_EXPLORE = [
  '【厳守】あなたはこのリポジトリのファイルを一切 Read/Grep/Bash してはならない。git 履歴も見てはならない。',
  '判断は下の課題文に書かれた材料だけで行うこと。外部を探索した時点でこの測定は無効になる。',
  '',
].join('\n')

const solo = (p) => `${NO_EXPLORE}${p.text}`
const withSkill = (p) => `${NO_EXPLORE}あなたは以下の skill を読み込んでいる。これに従って判定すること。\n\n===== SKILL: critic-verification-gate =====\n${skillA}\n===== SKILL ここまで =====\n\n${p.text}`

// 各 packet × {solo, skill} × runs をパイプラインで（barrier不要）
const rows = await parallel(
  packets.flatMap((p) => [
    () => parallel(Array.from({ length: runs }, (_, i) => () =>
      agent(`${solo(p)}\n\n(試行 #${i + 1})`, { label: `${p.id}-solo#${i + 1}`, phase: 'solo', model: 'opus', schema: VERDICT }))
    ).then((vs) => ({ id: p.id, arm: 'solo', verdicts: vs })),
    () => parallel(Array.from({ length: runs }, (_, i) => () =>
      agent(`${withSkill(p)}\n\n(試行 #${i + 1})`, { label: `${p.id}-skill#${i + 1}`, phase: 'skill', model: 'opus', schema: VERDICT }))
    ).then((vs) => ({ id: p.id, arm: 'skill', verdicts: vs })),
  ])
)

// 生 verdict をそのまま返す（clean/欠陥・R1/R2 の突合は封印キーで人手裁定）
const compact = (v) => v && { ok: v.ok, confidence: v.confidence, needsRedesign: v.needsRedesign, issues: (v.issues || '').slice(0, 600) }
return {
  runs,
  note: 'ok:true & confidence:高 が MISS 候補。clean packet では逆に ok:true & 高 が正解（特異度）。裁定は ANSWER-KEY と突合。',
  results: rows.map((r) => ({ id: r.id, arm: r.arm, verdicts: r.verdicts.map(compact) })),
}
