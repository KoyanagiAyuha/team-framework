# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### プリペイド残高チャージ：PayGateway 決済完了 Webhook の受信処理

#### 1. 背景

ユーザーがクレジットカードでプリペイド残高をチャージすると、決済代行の PayGateway が決済完了イベントを当社の Webhook エンドポイントに POST する。この受信処理を実装する。

#### 2. 処理内容

決済完了イベントを受信したら、次を順に行う。

1. リクエストの署名を検証する（検証失敗時は 401 を返し、以降の処理は行わない）。
2. イベントに含まれるチャージ額をユーザーの残高に加算する。
3. チャージ履歴に記録する（イベントID・ユーザーID・金額）。
4. ユーザーに領収メールを送信する。
5. 200 を返す。

#### 3. イベントペイロード

```
PaymentEvent {
  event_id: string     // PayGateway が発行するイベント識別子
  user_id: string
  amount: number       // チャージ額（円・正の整数）
  occurred_at: string  // ISO 8601
}
```

#### 4. インターフェース

依存はすべて `deps` として注入される（残高ストア・履歴ストア・メール送信・署名秘密鍵）。HTTPフレームワークへの接続は上位層の責務で、本実装は `(req, deps) => HttpResponse` の純粋なハンドラ関数とする。

#### 5. 共通事項

- ペイロードの型不正・欠損の扱いは共通バリデーションミドルウェア（上位層）の責務で本実装の範囲外。
- メール送信の失敗はチャージ処理を妨げない扱いにしたいが、これは別チケット（リトライ基盤の導入待ち）で対応するため本実装では考慮不要。
- 性能要件なし。

#### 付録: PayGateway 連携仕様（プロバイダのドキュメントより抜粋）

- リクエストには `x-paygateway-signature` ヘッダが付与される。値はリクエストボディの HMAC-SHA256（16進表記）。
- 配送について: PayGateway は 2xx 応答を受け取れなかった場合（接続失敗、および応答タイムアウト 10 秒を含む）、間隔を空けて最大 5 回まで同一イベントを再送する。再送されるイベントは初回と同一の `event_id` を持つ。
- サンドボックス環境では管理画面からイベントの手動再送も可能。

## 提出された実装（全文）

```ts
// charge-webhook.ts
import { createHmac, timingSafeEqual } from 'node:crypto'

export type PaymentEvent = {
  event_id: string
  user_id: string
  amount: number
  occurred_at: string
}

export type Deps = {
  secret: string
  balances: { add(userId: string, amount: number): Promise<void> }
  history: {
    append(rec: { eventId: string; userId: string; amount: number }): Promise<void>
  }
  mailer: { sendChargeReceipt(userId: string, amount: number): Promise<void> }
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

/** PayGateway 決済完了 Webhook ハンドラ */
export async function handleChargeWebhook(req: HttpRequest, deps: Deps): Promise<HttpResponse> {
  if (!verifySignature(req.rawBody, req.headers['x-paygateway-signature'], deps.secret)) {
    return { status: 401 }
  }
  const event = JSON.parse(req.rawBody) as PaymentEvent
  await deps.balances.add(event.user_id, event.amount)
  await deps.history.append({
    eventId: event.event_id,
    userId: event.user_id,
    amount: event.amount,
  })
  await deps.mailer.sendChargeReceipt(event.user_id, event.amount)
  return { status: 200 }
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// charge-webhook.test.ts
import { createHmac } from 'node:crypto'
import { handleChargeWebhook, Deps } from './charge-webhook'

const SECRET = 'test-secret'
const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('hex')

function makeDeps() {
  const calls = { add: [] as unknown[], append: [] as unknown[], mail: [] as unknown[] }
  const deps: Deps = {
    secret: SECRET,
    balances: { add: async (u, a) => void calls.add.push([u, a]) },
    history: { append: async (r) => void calls.append.push(r) },
    mailer: { sendChargeReceipt: async (u, a) => void calls.mail.push([u, a]) },
  }
  return { deps, calls }
}

const body = JSON.stringify({
  event_id: 'evt_001', user_id: 'u1', amount: 3000, occurred_at: '2026-07-01T10:00:00Z',
})

test('署名不正は 401 で処理しない', async () => {
  const { deps, calls } = makeDeps()
  const res = await handleChargeWebhook({ rawBody: body, headers: { 'x-paygateway-signature': 'bad' } }, deps)
  expect(res.status).toBe(401)
  expect(calls.add).toHaveLength(0)
})

test('正常系: 残高加算・履歴記録・メール送信して 200', async () => {
  const { deps, calls } = makeDeps()
  const res = await handleChargeWebhook({ rawBody: body, headers: { 'x-paygateway-signature': sign(body) } }, deps)
  expect(res.status).toBe(200)
  expect(calls.add).toEqual([['u1', 3000]])
  expect(calls.append).toEqual([{ eventId: 'evt_001', userId: 'u1', amount: 3000 }])
  expect(calls.mail).toEqual([['u1', 3000]])
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: charge-webhook.ts / charge-webhook.test.ts の2ファイル

## Worker の申告

> 「仕様の処理内容 1〜5 をすべて実装しました。署名検証はタイミング攻撃対策済み（timingSafeEqual）。テスト・型検査とも green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
