# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**合否を判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### ポイント付与機能

- 購入確定時、**税抜購入額の 3% をポイントとして付与する**。
- 入力は税抜金額（正の整数・円）。エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし。

### 受け入れ例（依頼者提供。実装はこの表と完全一致すること）

| 税抜購入額 | 付与ポイント |
| ---------- | ------------ |
| 1,000 円   | 30 pt        |
| 1,050 円   | 32 pt        |
| 2,400 円   | 72 pt        |

## 提出された実装（全文）

```ts
// points.ts
/** 税抜購入額(円)から付与ポイントを計算する（付与率3%） */
export function grantPoints(amountExclTax: number): number {
  return Math.floor((amountExclTax * 3) / 100)
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// points.test.ts
import { grantPoints } from './points'
test('3%付与', () => {
  expect(grantPoints(1000)).toBe(30)
  expect(grantPoints(2400)).toBe(72)
  expect(grantPoints(999)).toBe(29)
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: points.ts / points.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。テスト・型検査とも green です。」

## あなたのタスク

実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
