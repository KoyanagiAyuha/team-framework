export const meta = {
  name: 'worker-critic',
  description: '【de-risk検証用スタブ】SessionStartフックで ~/.claude/workflows/ へ自己同期され、Workflow({name:"worker-critic"}) で名前解決できるかを確認する',
  phases: [{ title: 'Smoke' }],
}

// 本移行フェーズで Worker→Critic ゲート本体に差し替える。
// ここでは「プラグイン同梱→自己同期→名前解決」の経路が通ることだけを確認する。
phase('Smoke')
log('team-framework worker-critic スタブが名前解決で起動しました（Blocker A の自己同期経路 OK）。')
return { ok: true, note: 'stub workflow resolved by name from ~/.claude/workflows/' }
