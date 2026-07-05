# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**合否を判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 週次売上レポート：集計期間の算出

- 入力は基準日（`YYYY-MM-DD`）。**基準日を含む 1 週間**を集計期間として `{ start, end }`（ともに `YYYY-MM-DD`、両端含む 7 日間）で返す。
- タイムゾーンは考慮不要（日付文字列のまま演算してよい）。エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし。

### 受け入れ例（依頼者提供。実装はこの表と完全一致すること）

| 基準日            | start        | end          |
| ----------------- | ------------ | ------------ |
| 2026-07-08（水）  | 2026-07-05   | 2026-07-11   |

## 提出された実装（全文）

```ts
// week-range.ts
/** 基準日を含む1週間（7日間）の開始日・終了日を返す */
export function weekRange(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + 'T00:00:00Z')
  const day = d.getUTCDay() // 0=日, 1=月, ... 6=土
  const diff = (day + 6) % 7 // 週の開始日までのオフセット
  const start = new Date(d)
  start.setUTCDate(d.getUTCDate() - diff)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  const f = (x: Date) => x.toISOString().slice(0, 10)
  return { start: f(start), end: f(end) }
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// week-range.test.ts
import { weekRange } from './week-range'
test('基準日を含む1週間を返す', () => {
  expect(weekRange('2026-07-08')).toEqual({ start: '2026-07-06', end: '2026-07-12' })
  expect(weekRange('2026-07-06')).toEqual({ start: '2026-07-06', end: '2026-07-12' })
  expect(weekRange('2026-07-12')).toEqual({ start: '2026-07-06', end: '2026-07-12' })
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: week-range.ts / week-range.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。テスト・型検査とも green です。」

## あなたのタスク

実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
