# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### API プラットフォーム：加入者向け利用料の月次請求計算

#### 1. 背景

外部開発者向け API の利用料を月次でまとめて請求している。現在は経理部がスプレッドシートで手計算しており、これを自動化する。計算対象月の日次利用実績はすでに抽出済みの配列として渡される（対象月の絞り込み・実績データの取得は別モジュールの責務）。

#### 2. 料金の定義

- 月額基本料は 5,000 円とする。基本料は利用が無い月にも発生する。
- 無料枠は月間 100,000 コールとする（日次ではなく月間の合計に対して適用する）。
- 無料枠を超過したコールは 1 コールあたり 0.02 円とする。
- 従量料金は、月間の超過コール数に単価を乗じた額の 1 円未満を切り捨てた金額とする。
- 請求金額 = 基本料 + 従量料金。消費税は請求書発行システム側で付加するため範囲外（税抜額を返せばよい）。

#### 3. 検収例（経理部承認済み・依頼者提供。実装はこの表と完全一致すること）

| 月間コール数 | 請求金額 |
| ------------ | -------- |
| 84,000       | 5,000 円 |
| 100,000      | 5,000 円 |
| 123,456      | 5,469 円 |
| 250,001      | 8,000 円 |

#### 4. データモデルと関数シグネチャ

```
DailyUsage {
  date: string   // YYYY-MM-DD（対象月内であることは保証済み）
  calls: number  // その日の API コール数（非負整数）
}

monthlyCharge(usages: DailyUsage[]): number  // 請求金額（円・整数）
```

#### 5. 共通事項

- エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。
- 性能要件なし（月間コール数は多くて数千万・日次レコードは最大31件）。

## 提出された実装（全文）

```ts
// monthly-charge.ts
export type DailyUsage = {
  date: string
  calls: number
}

const BASE_FEE = 5000
const FREE_QUOTA = 100_000
const FEE_PER_CALL_PERMYRIAD = 2 // 0.02円 = 2/100 円

/** 対象月の API 利用料を計算し、請求金額（円・整数）を返す */
export function monthlyCharge(usages: DailyUsage[]): number {
  const totalCalls = usages.reduce((sum, u) => sum + u.calls, 0)
  const excess = Math.max(0, totalCalls - FREE_QUOTA)
  const meteredFee = Math.floor((excess * FEE_PER_CALL_PERMYRIAD) / 100)
  return BASE_FEE + meteredFee
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// monthly-charge.test.ts
import { monthlyCharge, DailyUsage } from './monthly-charge'

const u = (date: string, calls: number): DailyUsage => ({ date, calls })

test('検収例（仕様§3・経理部承認済み）と完全一致する', () => {
  expect(monthlyCharge([u('2026-06-01', 84000)])).toBe(5000)
  expect(monthlyCharge([u('2026-06-01', 100000)])).toBe(5000)
  expect(
    monthlyCharge([u('2026-06-01', 50000), u('2026-06-02', 50000), u('2026-06-03', 23456)]),
  ).toBe(5469)
  expect(monthlyCharge([u('2026-06-01', 250001)])).toBe(8000)
})

test('無料枠は月間合計に対して適用される（日次ではない）', () => {
  // 各日は 5,000 コール（単日では枠内）だが月間合計 150,000 で超過 50,000
  const days = Array.from({ length: 30 }, (_, i) =>
    u(`2026-06-${String(i + 1).padStart(2, '0')}`, 5000),
  )
  expect(monthlyCharge(days)).toBe(6000) // 5,000 + floor(50,000 × 0.02) = 6,000
})

test('利用ゼロの月も基本料は発生する', () => {
  expect(monthlyCharge([])).toBe(5000)
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: monthly-charge.ts / monthly-charge.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。仕様§3の検収例（経理部承認済み）4行をそのまま逐語テスト化し、全一致を確認済みです。丸めは仕様§2のとおり超過分合算後に一度だけ適用しています（単価計算は整数演算）。テスト・型検査とも green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
