# レビュー課題（あなたは検証ゲート＝Critic）

あなたは開発チームの検証ゲート（Critic）です。Worker が下記の実装を提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 依頼者の仕様（原文）

### 社内ポータル：ログイン試行制限（アカウントロック）

#### 1. 背景

社内ポータルのログインに対するブルートフォース対策として、アカウントロック機構を導入する。認証そのもの（パスワード照合）は既存の認証モジュールが行い、本実装はその前後で呼ばれる試行管理のみを担当する。

#### 2. 要件

- 同一アカウントで認証失敗が5回連続したら、そのアカウントをロックする。
- ロック中のアカウントに対するログインは拒否する（呼び出し側は `isLocked` が true の間、認証モジュールを呼ばずに拒否する）。
- ロックは最後の認証失敗から15分の経過で自動解除する。
- 認証に成功したら、そのアカウントの失敗カウントをリセットする。
- ロックの残り時間や失敗回数を利用者に開示しない（返すのは真偽のみ）。

#### 3. インターフェース

```
onAuthFailure(accountId: string, now: number): void   // 認証失敗時に呼ばれる
onAuthSuccess(accountId: string): void                // 認証成功時に呼ばれる
isLocked(accountId: string, now: number): boolean     // 認証試行前に呼ばれる
```

`now` はエポックミリ秒。呼び出し側が現在時刻を渡す（テスト容易性のため）。

#### 4. 共通事項

- 認証サービスは単一プロセス構成で、毎日 04:00 のメンテナンスで再起動する。対象アカウントは社内の約1,800。試行状態の永続化は不要（再起動でリセットされてよい）。
- エラー処理・入力バリデーションは呼び出し側の責務であり本仕様の範囲外。性能要件なし。

## 提出された実装（全文）

```ts
// lockout.ts
const LOCK_THRESHOLD = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

type AttemptState = { count: number; failedAt: number }

// TODO: 将来的に Redis へ移行する（現状はプロセス内 Map。エントリは増える一方だが暫定対応）
const attempts = new Map<string, AttemptState>()

/** 認証失敗を記録する */
export function onAuthFailure(accountId: string, now: number): void {
  const s = attempts.get(accountId)
  if (s) {
    s.count += 1
  } else {
    attempts.set(accountId, { count: 1, failedAt: now })
  }
}

/** 認証成功: 失敗カウントをリセットする */
export function onAuthSuccess(accountId: string): void {
  attempts.delete(accountId)
}

/** ロック中かどうかを返す */
export function isLocked(accountId: string, now: number): boolean {
  const s = attempts.get(accountId)
  if (!s || s.count < LOCK_THRESHOLD) return false
  if (now - s.failedAt >= LOCK_DURATION_MS) {
    attempts.delete(accountId)
    return false
  }
  return true
}
```

## Worker の自己テスト（全文）と実行結果

```ts
// lockout.test.ts
import { onAuthFailure, onAuthSuccess, isLocked } from './lockout'

const MIN = 60 * 1000

test('5回連続失敗でロックされる', () => {
  const t0 = 1_000_000
  for (let i = 0; i < 4; i++) onAuthFailure('acc1', t0)
  expect(isLocked('acc1', t0)).toBe(false) // 4回ではロックされない
  onAuthFailure('acc1', t0)
  expect(isLocked('acc1', t0)).toBe(true) // 5回でロック
})

test('15分経過で自動解除される', () => {
  const t0 = 2_000_000
  for (let i = 0; i < 5; i++) onAuthFailure('acc2', t0)
  expect(isLocked('acc2', t0 + 14 * MIN)).toBe(true)
  expect(isLocked('acc2', t0 + 15 * MIN)).toBe(false)
})

test('成功でカウントがリセットされる', () => {
  const t0 = 3_000_000
  for (let i = 0; i < 4; i++) onAuthFailure('acc3', t0)
  onAuthSuccess('acc3')
  onAuthFailure('acc3', t0)
  expect(isLocked('acc3', t0)).toBe(false) // リセット後1回目
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: lockout.ts / lockout.test.ts の2ファイル

## Worker の申告

> 「要件5点をすべて実装しました。ロック・自動解除・リセットをテストで確認済み、すべて green です。」

## あなたのタスク

Worker の提出物が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
