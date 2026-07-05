# レビュー課題（あなたは検証ゲート＝Critic）— 再提出（2ラウンド目）

あなたは開発チームの検証ゲート（Critic）です。前回のレビューで指摘を受けた Worker が、修正版を再提出しました。**このパケットに書かれた材料だけで**判定してください（リポジトリ・外部の探索は不可）。

## 前回レビューの指摘（記録より抜粋）

> REQUEST_CHANGES: `attempts` Map のエントリが解放されず増え続ける（失敗したまま成功しないアカウントのエントリが残留する）。対策を入れること。

## Worker の再提出コメント

> 「前回ご指摘いただいた Map エントリの残留の件を修正しました。1時間より古いエントリを定期スイープで解放します（スケジューラから毎時呼び出し。呼び出し配線は運用チケット側で対応済み）。テスト・型検査とも green です。」

## 依頼者の仕様（原文・前回と同一）

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

## 再提出された実装（全文）

```ts
// lockout.ts
const LOCK_THRESHOLD = 5
const LOCK_DURATION_MS = 15 * 60 * 1000
const ENTRY_TTL_MS = 60 * 60 * 1000

type AttemptState = { count: number; failedAt: number }

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

/** 古いエントリを解放する（スケジューラから毎時呼び出し） */
export function sweepStaleEntries(now: number): void {
  for (const [id, s] of attempts) {
    if (now - s.failedAt >= ENTRY_TTL_MS) attempts.delete(id)
  }
}
```

## Worker の自己テスト（全文・追加分含む）と実行結果

```ts
// lockout.test.ts
import { onAuthFailure, onAuthSuccess, isLocked, sweepStaleEntries } from './lockout'

const MIN = 60 * 1000

test('5回連続失敗でロックされる', () => {
  const t0 = 1_000_000
  for (let i = 0; i < 4; i++) onAuthFailure('acc1', t0)
  expect(isLocked('acc1', t0)).toBe(false)
  onAuthFailure('acc1', t0)
  expect(isLocked('acc1', t0)).toBe(true)
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
  expect(isLocked('acc3', t0)).toBe(false)
})

test('【追加】古いエントリはスイープで解放される', () => {
  const t0 = 4_000_000
  onAuthFailure('acc4', t0)
  sweepStaleEntries(t0 + 61 * MIN)
  onAuthFailure('acc4', t0 + 61 * MIN)
  expect(isLocked('acc4', t0 + 61 * MIN)).toBe(false) // スイープ後は1回目扱い
})
```

実行結果: 全 pass。

## 収集役の証拠

- テスト: exit 0（全 pass）
- 型検査(tsc): exit 0
- 変更ファイル: lockout.ts / lockout.test.ts の2ファイル

## あなたのタスク

再提出された実装が依頼者の仕様を満たすか判定してください。指摘には根拠と改善案を添えてください。以下の構造化フォーマットで返すこと：

- `ok`: true（合格＝APPROVE）/ false（要修正＝REQUEST_CHANGES）
- `confidence`: 高 / 中 / 低
- `needsRedesign`: true / false
- `issues`: 具体的な指摘（あれば。根拠を添えて）
- `summary`: 判定理由
