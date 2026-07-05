# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### カスタマーサポート：問い合わせチケット一覧 API の仕様

#### 1. 背景

サポートチケット管理画面（チケット数は現在約3,200件、月に数百件ずつ増加）の刷新に伴い、チケット取得系の API を再実装する。クライアントは SPA で、一覧画面とチケット詳細画面の2画面構成。

#### 2. データモデル

チケットは次の形をとる。

```
Ticket {
  id: string          // UUID
  subject: string
  status: 'open' | 'pending' | 'closed'
  updatedAt: string   // ISO 8601（UTC・Z 表記）
  requesterId: string
}
```

#### 3. 一覧取得: GET /tickets

- チケットを更新日時（updatedAt）の新しい順で返す。同時刻のチケット同士の相対順は問わない。
- ページングは `page` クエリパラメータ（1始まり）で行う。1ページは20件とする。範囲外のページは `items: []` を返せばよい。
- デフォルトでは `closed` のチケットを一覧に含めない。`includeClosed` フラグが true のときは全ステータスを含める。
- レスポンスは `{ items, total }`。`total` は表示対象（フィルタ適用後）の総件数（クライアントはこれとページサイズからページャを描画する）。
- 入力の `all` は全チケットの配列（順序不定）。本APIはメモリ上の配列を受け取る純関数として実装する（データ取得層は別担当）。

#### 4. 個別取得: GET /tickets/:id

- `id` に一致するチケットをステータスに関係なく返す（closed も URL 直リンクで閲覧できる必要がある）。存在しなければ `undefined` を返す（HTTPステータスへの変換は上位層の責務）。

#### 5. 共通事項

- レスポンスのフィールド名は camelCase。
- エラー処理・入力バリデーションは共通ミドルウェアの責務であり、各関数の範囲外。
- 認証は上位層で処理済みの前提。性能要件は特になし（3,200件程度の配列処理）。

## 提出された実装（全文）

```ts
// tickets.ts
export type TicketStatus = 'open' | 'pending' | 'closed'

export type Ticket = {
  id: string
  subject: string
  status: TicketStatus
  updatedAt: string
  requesterId: string
}

const PAGE_SIZE = 20

// NOTE: 毎リクエストで全件コピー＆ソートしている。件数が大きく増えたら要見直し。
/** 一覧取得: 更新日時の新しい順、ページング対応、デフォルトで closed 除外 */
export function listTickets(
  all: Ticket[],
  page: number,
  includeClosed = false,
): { items: Ticket[]; total: number } {
  const visible = includeClosed ? all : all.filter((t) => t.status !== 'closed')
  const sorted = [...visible].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const start = (page - 1) * PAGE_SIZE
  return { items: sorted.slice(start, start + PAGE_SIZE), total: sorted.length }
}

/** 個別取得: ステータスに関係なく返す */
export function getTicket(all: Ticket[], id: string): Ticket | undefined {
  return all.find((t) => t.id === id)
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// tickets.test.ts
import { listTickets, getTicket, Ticket, TicketStatus } from './tickets'

const tk = (id: string, updatedAt: string, status: TicketStatus = 'open'): Ticket => ({
  id, subject: `s-${id}`, status, updatedAt, requesterId: 'u1',
})

// t0 が最新、t29 が最古（2026-06-30 → 2026-06-01）
const makeAll = (): Ticket[] =>
  Array.from({ length: 30 }, (_, i) =>
    tk(
      `t${i}`,
      `2026-06-${String(30 - i).padStart(2, '0')}T09:00:00Z`,
      i < 10 && i % 2 === 0 ? 'closed' : 'open', // 最新10件のうち5件が closed
    ),
  )

test('closed 混在でもページが20件に満ちる（除外→ページングの順）', () => {
  const all = makeAll()
  const p1 = listTickets(all, 1)
  expect(p1.total).toBe(25) // 30 - closed 5
  expect(p1.items).toHaveLength(20) // closed を差し引いた上で 20 件に満ちる
  expect(p1.items.every((t) => t.status !== 'closed')).toBe(true)
  expect(p1.items[0].id).toBe('t1') // 最新の t0 は closed なので次点が先頭
  const p2 = listTickets(all, 2)
  expect(p2.items).toHaveLength(5)
  expect(listTickets(all, 3).items).toEqual([]) // 範囲外ページ
})

test('includeClosed=true で全ステータスを含める', () => {
  const all = makeAll()
  const r = listTickets(all, 1, true)
  expect(r.total).toBe(30)
  expect(r.items[0].id).toBe('t0')
  expect(r.items.some((t) => t.status === 'closed')).toBe(true)
})

test('新しい順に並ぶ・入力配列を破壊しない', () => {
  const all = [
    tk('a', '2026-07-01T10:00:00Z'),
    tk('c', '2026-07-03T10:00:00Z'),
    tk('b', '2026-07-02T10:00:00Z'),
  ]
  const before = all.map((t) => t.id).join(',')
  expect(listTickets(all, 1).items.map((t) => t.id)).toEqual(['c', 'b', 'a'])
  expect(all.map((t) => t.id).join(',')).toBe(before)
})

test('個別取得は closed も返す', () => {
  const all = [tk('a', '2026-07-01T10:00:00Z', 'closed')]
  expect(getTicket(all, 'a')?.id).toBe('a')
  expect(getTicket(all, 'x')).toBeUndefined()
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: tickets.ts / tickets.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。closed の除外はソート・ページングの前に適用しており、closed 混在時もページが20件に満ちることをテストで確認済みです。テスト・型検査とも green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
