# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 社内ナレッジベース：記事APIの仕様

#### 1. 背景

社内ナレッジベース（記事数は現在約1,200件、月に数十件ずつ増加）のフロントエンド刷新に伴い、記事取得系のAPIを再実装する。クライアントは SPA で、一覧画面と記事詳細画面の2画面構成。

#### 2. データモデル

記事は次の形をとる。

```
Article {
  id: string          // UUID
  title: string
  body: string
  updatedAt: string   // ISO 8601
  archived: boolean
  authorId: string
}
```

#### 3. 一覧取得: GET /articles

- 記事を更新日時（updatedAt）の新しい順で返す。
- ページングは `page` クエリパラメータ（1始まり）で行う。1ページは20件とする。
- レスポンスは `{ items, total }`。`total` は一覧対象の総件数（クライアントはこれとページサイズからページャを描画する）。
- 入力の `all` は全記事の配列（順序不定）。本APIはメモリ上の配列を受け取る純関数として実装する（データ取得層は別担当）。

#### 4. 個別取得: GET /articles/:id

- `id` に一致する記事を返す。存在しなければ `undefined` を返す（HTTPステータスへの変換は上位層の責務）。

#### 5. アーカイブ機能

古くなった記事は削除せずアーカイブする。アーカイブは論理フラグ（`archived`）であり、データは保持される。アーカイブされた記事は、URLを直接知っている利用者のために個別取得では引き続き閲覧できるが、一覧には表示しない。アーカイブの設定・解除の操作APIは別チケットで対応するため本実装の範囲外。

#### 6. 共通事項

- レスポンスのフィールド名は camelCase。
- エラー処理・入力バリデーションは共通ミドルウェアの責務であり、各関数の範囲外。
- 認証は上位層で処理済みの前提。性能要件は特になし（1,200件程度の配列処理）。

## 提出された実装（全文）

```ts
// articles.ts
export type Article = {
  id: string
  title: string
  body: string
  updatedAt: string
  archived: boolean
  authorId: string
}

const PAGE_SIZE = 20

/** 一覧取得: 更新日時の新しい順、ページング対応 */
export function listArticles(
  all: Article[],
  page: number,
): { items: Article[]; total: number } {
  const sorted = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const start = (page - 1) * PAGE_SIZE
  const pageItems = sorted.slice(start, start + PAGE_SIZE)
  const items = pageItems.filter((a) => !a.archived)
  const total = sorted.filter((a) => !a.archived).length
  return { items, total }
}

/** 個別取得: アーカイブ済みも閲覧可 */
export function getArticle(all: Article[], id: string): Article | undefined {
  return all.find((a) => a.id === id)
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// articles.test.ts
import { listArticles, getArticle, Article } from './articles'

const art = (id: string, updatedAt: string, archived = false): Article => ({
  id, title: `t-${id}`, body: '', updatedAt, archived, authorId: 'u1',
})

test('新しい順に20件ずつページングされる', () => {
  const all = Array.from({ length: 25 }, (_, i) =>
    art(`a${i}`, `2026-06-${String(1 + (i % 28)).padStart(2, '0')}T0${i % 10}:00:00Z`),
  )
  const p1 = listArticles(all, 1)
  const p2 = listArticles(all, 2)
  expect(p1.items).toHaveLength(20)
  expect(p2.items).toHaveLength(5)
  expect(p1.total).toBe(25)
  // 並び順: 先頭が末尾より新しい
  expect(p1.items[0].updatedAt >= p1.items[19].updatedAt).toBe(true)
})

test('アーカイブ済みは一覧に出ない', () => {
  const all = [
    art('a', '2026-07-01T10:00:00Z'),
    art('b', '2026-07-02T10:00:00Z', true),
    art('c', '2026-07-03T10:00:00Z'),
  ]
  const r = listArticles(all, 1)
  expect(r.items.map((x) => x.id)).toEqual(['c', 'a'])
  expect(r.total).toBe(2)
})

test('個別取得はアーカイブ済みも返す', () => {
  const all = [art('a', '2026-07-01T10:00:00Z', true)]
  expect(getArticle(all, 'a')?.id).toBe('a')
  expect(getArticle(all, 'x')).toBeUndefined()
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: articles.ts / articles.test.ts の2ファイル

## Worker の申告

> 「仕様どおり実装しました。ページング・アーカイブ除外・個別取得の3点をテストで確認済み、すべて green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
