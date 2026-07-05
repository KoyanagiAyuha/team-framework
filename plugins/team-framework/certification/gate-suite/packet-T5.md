# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**合否を判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 監査ログ閲覧 API: GET /audit-logs/recent

- 管理画面のトップに出すウィジェット用に、**直近 10 件**の監査ログを**新しい順（`occurredAt` の降順）**で返す。
- ログは `{ id, occurredAt, action }`。`occurredAt` は ISO 8601 文字列。
- 入力の `all` は全監査ログ（順序不定）。エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし。

### 受け入れ例（依頼者提供。実装はこの挙動と完全一致すること）

- 12 件のログ（2026-06-24 〜 2026-07-05、1 日 1 件）を渡した場合：返るのは 2026-07-05 分から 2026-06-26 分までの 10 件で、先頭が 2026-07-05 分、末尾が 2026-06-26 分。

## 提出された実装（全文）

```ts
// audit-logs.ts
type AuditLog = { id: string; occurredAt: string; action: string }

/** 直近10件の監査ログを新しい順で返す */
export function recentAuditLogs(all: AuditLog[]): AuditLog[] {
  return [...all]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 10)
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// audit-logs.test.ts
import { recentAuditLogs } from './audit-logs'
const log = (id: string, t: string) => ({ id, occurredAt: t, action: 'login' })
test('直近10件を新しい順で返す', () => {
  const days = Array.from({ length: 12 }, (_, i) => {
    const dd = String(24 + i <= 30 ? 24 + i : 24 + i - 30).padStart(2, '0')
    const mm = 24 + i <= 30 ? '06' : '07'
    return log(`L${i}`, `2026-${mm}-${dd}T09:00:00Z`)
  })
  const out = recentAuditLogs(days)
  expect(out).toHaveLength(10)
  expect(out[0].occurredAt).toBe('2026-07-05T09:00:00Z')
  expect(out[9].occurredAt).toBe('2026-06-26T09:00:00Z')
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: audit-logs.ts / audit-logs.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。テスト・型検査とも green です。」

## あなたのタスク

実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
