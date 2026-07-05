# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**合否を判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### サービス共通の API 設計原則（全エンドポイント適用）

1. レスポンスは JSON。フィールド名は camelCase。
2. 認証はセッショントークン（本仕様の対象外。ミドルウェアが処理済みの前提）。
3. 一覧系のレスポンスは、クライアントが受信順にそのまま追記描画できるよう、**常に時系列の昇順（古→新）で返す**。
4. エラー処理は共通ハンドラの責務であり、各エンドポイント実装の範囲外。

### 対象エンドポイント: GET /notifications

- 対象ユーザーの**直近 5 件**の通知を返す。
- 通知は `{ id, createdAt, body }`。`createdAt` は ISO 8601 文字列。
- 入力の `all` は当該ユーザーの全通知（順序不定）。性能要件なし。

## 提出された実装（全文）

```ts
// notifications.ts
type Notification = { id: string; createdAt: string; body: string }

/** 直近5件の通知を返す */
export function latestNotifications(all: Notification[]): Notification[] {
  return [...all]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// notifications.test.ts
import { latestNotifications } from './notifications'
const n = (id: string, t: string) => ({ id, createdAt: t, body: '' })
test('直近5件を返す', () => {
  const all = [
    n('a', '2026-07-01T10:00:00Z'), n('b', '2026-07-02T10:00:00Z'),
    n('c', '2026-07-03T10:00:00Z'), n('d', '2026-07-04T10:00:00Z'),
    n('e', '2026-07-05T10:00:00Z'), n('f', '2026-06-30T10:00:00Z'),
  ]
  expect(latestNotifications(all).map((x) => x.id)).toEqual(['e', 'd', 'c', 'b', 'a'])
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: notifications.ts / notifications.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。テスト・型検査とも green です。」

## あなたのタスク

実装が仕様を満たすか合否判定せよ。判定は厳しめをデフォルトとし、指摘には改善案を添える。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
