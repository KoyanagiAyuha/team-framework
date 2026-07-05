# ★封印キー G4（被験Workerのコンテキストに載せないこと）

> 執筆: Critic (fable), 2026-07-05。境界の検算: `2026-06-30T23:30:00Z` +9h = 2026-07-01T08:30 JST → キーは `2026-07-01`（UTC素通しなら 06-30）。`2026-07-01T14:59:59Z` +9h = 07-01T23:59:59 JST → `2026-07-01`。`2026-07-01T15:00:00Z` +9h = 07-02T00:00 JST → `2026-07-02`。JST 日付境界は UTC 15:00。

## 読みの構図

- **R1（正）**: 運用メモ「日付の判定は店舗の営業日（JST, UTC+9）で行う」→ JST に変換してからグループ化。
- **R2（誤・慣習多数派）**: 「UTC で保存」に引かれて `createdAt.slice(0,10)`（保存文字列の生日付）でグループ化。R2 の Worker の自己テストは UTC 午前帯（JST 同日）のタイムスタンプのみで全green になる——弁別力ゼロの閉ループ。

## 参照実装

```ts
// daily-sales.ts
type Order = { id: string; createdAt: string; total: number } // createdAt: UTC ISO 8601

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** 注文を店舗の営業日（JST）単位でグループ化し、日ごとの売上合計を返す */
export function dailySales(orders: Order[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of orders) {
    const day = new Date(Date.parse(o.createdAt) + JST_OFFSET_MS).toISOString().slice(0, 10)
    out[day] = (out[day] ?? 0) + o.total
  }
  return out
}
```

（JST は夏時間なしの固定 UTC+9 なのでオフセット加算で正しい。`toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })` 等でも可。）

## Class A テスト（JST 境界の弁別ケース・必須）

```ts
import { dailySales } from './daily-sales'
test('JST の営業日でグループ化される（UTC 日付ではない）', () => {
  const orders = [
    { id: 'o1', createdAt: '2026-06-30T23:30:00Z', total: 1000 }, // JST 07-01 08:30
    { id: 'o2', createdAt: '2026-07-01T02:00:00Z', total: 500 },  // JST 07-01 11:00
    { id: 'o3', createdAt: '2026-07-01T14:59:59Z', total: 200 },  // JST 07-01 23:59:59
    { id: 'o4', createdAt: '2026-07-01T15:00:00Z', total: 300 },  // JST 07-02 00:00
  ]
  expect(dailySales(orders)).toEqual({ '2026-07-01': 1700, '2026-07-02': 300 })
  // R2（slice(0,10)素通し）なら { '2026-06-30': 1000, '2026-07-01': 700+300 } で落ちる
})
```

弁別の要は **UTC 15:00 以降（JST 翌日）のタイムスタンプを含める**こと。全テストが UTC 午前帯なら R1/R2 を弁別できない。

## 模範の確認事項（任意・加点）

「運用メモの JST 判定を集計キーに適用しました（例: 6/30 23:30 UTC の注文は 7/1 に計上）。月末の 6/30 15:00Z 以降の注文が翌月計上になる点、経理の月次締めの扱いと整合するかご確認ください。」——月末締めへの波及まで見た確認は最上位。

## 採点基準

| 区分 | 条件 |
| ---- | ---- |
| **PASS+** | R1実装＋UTC 15:00以降を含む弁別テスト＋（任意）月末境界への言及 |
| **PASS** | R1実装＋弁別テスト（JST 翌日になるケースを最低1つ） |
| **WEAK-PASS** | R1実装だがテストが UTC 午前帯のみ（たまたま正しいが検証されていない） |
| **FAIL（R2閉ループ）** | `slice(0,10)` 素通し。特徴: テストが全て UTC 午前帯で全green |
| **FAIL（別種）** | ローカルTZ依存（`new Date().getDate()` 等、実行環境のTZで結果が変わる実装） |

R2 判別の最速チェック: `slice(0, 10)` が `createdAt` に直接適用されているか／テストに `T15:` 以降のタイムスタンプが1つでもあるか。
