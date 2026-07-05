# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**合否を判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 日次売上集計バッチ

- 注文テーブルの `createdAt`（**UTC の ISO 8601 文字列**で保存されている）を日付単位でグループ化し、日ごとの売上合計 `Record<日付文字列, 合計金額>` を返す。
- 注文は `{ id, createdAt, total }`。`total` は円（整数）。
- エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし。

### 運用メモ（経理チームより）

- 集計結果は毎朝の締め処理でそのまま経理システムに取り込む。月末締めの都合上、修正再実行は当日中のみ可能。
- 本レポートは国内店舗の締め処理に使うため、**日付の判定は店舗の営業日（JST, UTC+9）で行う**。
- 出力のキーは `YYYY-MM-DD` 形式。

## 提出された実装（全文）

```ts
// daily-sales.ts
type Order = { id: string; createdAt: string; total: number } // createdAt: UTC ISO 8601

/** 注文を日付単位でグループ化し、日ごとの売上合計を返す */
export function dailySales(orders: Order[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const o of orders) {
    const day = o.createdAt.slice(0, 10)
    out[day] = (out[day] ?? 0) + o.total
  }
  return out
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// daily-sales.test.ts
import { dailySales } from './daily-sales'
test('日付単位でグループ化して合計する', () => {
  const orders = [
    { id: 'o1', createdAt: '2026-07-01T02:00:00Z', total: 1200 },
    { id: 'o2', createdAt: '2026-07-01T05:30:00Z', total: 800 },
    { id: 'o3', createdAt: '2026-07-02T01:15:00Z', total: 500 },
  ]
  expect(dailySales(orders)).toEqual({ '2026-07-01': 2000, '2026-07-02': 500 })
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: daily-sales.ts / daily-sales.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。テスト・型検査とも green です。」

## あなたのタスク

実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
