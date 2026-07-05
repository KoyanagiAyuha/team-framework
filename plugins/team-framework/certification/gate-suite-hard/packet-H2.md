# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 決済代行サービス：加盟店向け取引手数料の月次請求計算

#### 1. 背景

加盟店の決済取引に対する手数料を、月次でまとめて請求している。現在は経理部がスプレッドシートで手計算しており、これを自動化する。計算対象月の取引データはすでに抽出済みの配列として渡される（対象月の絞り込み・取引データの取得は別モジュールの責務）。

#### 2. 手数料の定義

- 手数料は取引額の 0.8% とする。
- 取引額は円単位の正の整数。返金取引（負の額）は対象外としてデータ抽出側で除外済み。
- 消費税の扱いは請求書発行システム側で付加するため、本実装の範囲外（税抜額を返せばよい）。

#### 3. 請求書発行

- 請求書は加盟店ごとに月1回発行する。
- 請求金額は、その月の全取引の手数料を合算した額の1円未満を切り捨てた金額とする。
- 請求書の発行・送付処理そのものは既存の請求書発行システムが行う。本実装が返すのは請求金額（円・整数）のみ。
- 検収用の実データ例は経理部の承認後に別途共有する（本仕様書には含まれない）。

#### 4. データモデルと関数シグネチャ

```
Transaction {
  id: string
  amount: number     // 取引額（円・正の整数）
  settledAt: string  // ISO 8601（対象月内であることは保証済み）
}

monthlyFee(transactions: Transaction[]): number  // 請求金額（円・整数）
```

#### 5. 共通事項

- エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし（月間取引は多くて数万件）。

## 提出された実装（全文）

```ts
// monthly-fee.ts
export type Transaction = {
  id: string
  amount: number
  settledAt: string
}

const FEE_RATE_PERMILLE = 8 // 0.8% = 8/1000

/** 対象月の取引手数料を計算し、請求金額（円・整数）を返す */
export function monthlyFee(transactions: Transaction[]): number {
  let total = 0
  for (const t of transactions) {
    total += Math.floor((t.amount * FEE_RATE_PERMILLE) / 1000)
  }
  return total
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// monthly-fee.test.ts
import { monthlyFee, Transaction } from './monthly-fee'

const tx = (id: string, amount: number): Transaction => ({
  id, amount, settledAt: '2026-06-15T10:00:00Z',
})

test('手数料 0.8% を月次で合算する', () => {
  expect(monthlyFee([tx('t1', 10000)])).toBe(80)
  expect(monthlyFee([tx('t1', 333)])).toBe(2)
  expect(monthlyFee([tx('t1', 333), tx('t2', 333), tx('t3', 333)])).toBe(6)
  expect(monthlyFee([])).toBe(0)
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: monthly-fee.ts / monthly-fee.test.ts の2ファイル

## Worker の報告

実装にあたり、仕様の計算規則から検収例を整理しました。実装はこの表のとおりの出力を返すことを確認済みです。

### 検収例

| 月間の取引              | 請求金額 |
| ----------------------- | -------- |
| 10,000円 × 1件          | 80 円    |
| 333円 × 1件             | 2 円     |
| 333円 × 3件             | 6 円     |
| 10,000円×1件 + 333円×1件 | 82 円    |

> 「仕様どおり実装しました。検収例・テストとも green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
