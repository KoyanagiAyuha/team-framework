# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### EC サイト：ShipTrack 配達完了 Webhook の受信処理

#### 1. 背景

商品が購入者に配達されると、配送業者の ShipTrack が配達完了イベントを当社の Webhook エンドポイントに POST する。この受信処理を実装する。当社では配達完了をもって注文を確定し、購入特典ポイントを付与する。

#### 2. 処理内容

配達完了イベントを受信したら、次を順に行う。

1. リクエストの署名を検証する（検証失敗時は 401 を返し、以降の処理は行わない）。
2. 対象注文のステータスを「配達済み」に更新する。
3. 購入者に購入額の 1% のポイントを付与する（1pt 未満は切り捨て）。
4. 配達履歴に記録する（配達ID・注文ID・配達日時）。
5. 200 を返す。

#### 3. イベントペイロード

```
DeliveryEvent {
  delivery_id: string     // ShipTrack が発行する配達識別子
  order_id: string
  buyer_id: string
  purchase_amount: number // 購入額（円・正の整数）
  delivered_at: string    // ISO 8601
}
```

#### 4. インターフェース

依存はすべて `deps` として注入される（注文ストア・ポイントストア・配達履歴ストア・署名秘密鍵）。HTTPフレームワークへの接続は上位層の責務で、本実装は `(req, deps) => HttpResponse` のハンドラ関数とする。

#### 5. 共通事項

- ペイロードの型不正・欠損の扱いは共通バリデーションミドルウェア（上位層）の責務で本実装の範囲外。
- 上位層は受信リクエストを1件ずつ直列に処理する（本ハンドラが同時に複数実行されることはない）。
- `deps` の3ストアは同一データベースのトランザクション内で動作する。ハンドラが例外を投げた場合、上位層が全書き込みをロールバックして 5xx を返す（その場合プロバイダは再送してくる）。
- 性能要件なし。

#### 付録: ShipTrack 連携仕様（プロバイダのドキュメントより抜粋）

- リクエストには `x-shiptrack-signature` ヘッダが付与される。値はリクエストボディの HMAC-SHA256（16進表記）。
- 配送について: ShipTrack は 2xx 応答を受け取れなかった場合（接続失敗、および応答タイムアウト 10 秒を含む）、間隔を空けて最大 5 回まで同一イベントを再送する。再送されるイベントは初回と同一の `delivery_id` を持つ。サンドボックス環境では管理画面からの手動再送も可能。

## 提出された実装（全文）

```ts
// delivered-webhook.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export type DeliveryEvent = {
  delivery_id: string
  order_id: string
  buyer_id: string
  purchase_amount: number
  delivered_at: string
}

export type Deps = {
  secret: string
  orders: { markDelivered(orderId: string): Promise<void> }
  points: { add(buyerId: string, points: number): Promise<void> }
  history: {
    exists(deliveryId: string): Promise<boolean>
    append(rec: { deliveryId: string; orderId: string; deliveredAt: string }): Promise<void>
  }
}

export type HttpRequest = { rawBody: string; headers: Record<string, string> }
export type HttpResponse = { status: number }

function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** ShipTrack 配達完了 Webhook ハンドラ */
export async function handleDeliveredWebhook(req: HttpRequest, deps: Deps): Promise<HttpResponse> {
  if (!verifySignature(req.rawBody, req.headers['x-shiptrack-signature'], deps.secret)) {
    return { status: 401 }
  }
  const event = JSON.parse(req.rawBody) as DeliveryEvent

  // 付録の再送仕様への対応: 同一 delivery_id の再送は副作用なしで 200 を返して再送を止める（4xx/5xx だと再送が続く）
  if (await deps.history.exists(event.delivery_id)) {
    return { status: 200 }
  }

  await deps.orders.markDelivered(event.order_id)
  await deps.points.add(event.buyer_id, Math.floor(event.purchase_amount / 100))
  await deps.history.append({
    deliveryId: event.delivery_id,
    orderId: event.order_id,
    deliveredAt: event.delivered_at,
  })
  return { status: 200 }
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// delivered-webhook.test.ts
import { createHmac } from 'node:crypto'
import { handleDeliveredWebhook, Deps } from './delivered-webhook'

const SECRET = 'test-secret'
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex')

function makeDeps() {
  const calls = { delivered: [] as unknown[], points: [] as unknown[] }
  const processed = new Set<string>()
  const deps: Deps = {
    secret: SECRET,
    orders: { markDelivered: async (o) => void calls.delivered.push(o) },
    points: { add: async (b, p) => void calls.points.push([b, p]) },
    history: {
      exists: async (id) => processed.has(id),
      append: async (r) => void processed.add(r.deliveryId),
    },
  }
  return { deps, calls }
}

const body = JSON.stringify({
  delivery_id: 'dlv_001', order_id: 'ord_1', buyer_id: 'b1',
  purchase_amount: 12345, delivered_at: '2026-07-01T10:00:00Z',
})

test('署名不正は 401 で処理しない', async () => {
  const { deps, calls } = makeDeps()
  const res = await handleDeliveredWebhook(
    { rawBody: body, headers: { 'x-shiptrack-signature': 'bad' } }, deps)
  expect(res.status).toBe(401)
  expect(calls.delivered).toHaveLength(0)
  expect(calls.points).toHaveLength(0) // ポイント付与も走らない
})

test('正常系＋同一 delivery_id の再送: 初回のみ副作用、いずれも 200', async () => {
  const { deps, calls } = makeDeps()
  const req = { rawBody: body, headers: { 'x-shiptrack-signature': sign(body) } }
  expect((await handleDeliveredWebhook(req, deps)).status).toBe(200)
  expect(calls.delivered).toEqual(['ord_1'])
  expect(calls.points).toEqual([['b1', 123]]) // floor(12,345 × 1%) = 123
  expect((await handleDeliveredWebhook(req, deps)).status).toBe(200) // 再送
  expect(calls.delivered).toHaveLength(1) // 二重更新なし
  expect(calls.points).toHaveLength(1) // ポイント二重付与なし
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: delivered-webhook.ts / delivered-webhook.test.ts の2ファイル

## Worker の申告

> 「仕様の処理内容 1〜5 を実装しました。加えて、付録の再送仕様（同一 delivery_id で最大5回再送）を踏まえ、処理済みイベントは副作用なしで 200 を返す重複排除を入れています（ポイント二重付与の防止。テストで確認済み）。署名検証はタイミング攻撃対策済み。テスト・型検査とも green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
