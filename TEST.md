# フェーズ0：de-risk 検証手順

プラグイン化の本移行に進む前に、ドキュメントで未確定だった2つのブロッカーを実測で潰す。
**新規セッションが必要**（プラグインのinstall・新agent type・SessionStartフックは起動済みセッションには効かないため）。

## インストール（どちらか）

```bash
# A) ローカルディレクトリから読み込んで起動
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude --plugin-dir /Users/ayuhakoyanagi/Desktop/workspace/team-framework

# B) すでに起動中なら（v2.1.128+）
/plugin            # メニューからローカルプラグインを追加 → /reload-plugins
```

## チェックリスト

### ✅ Blocker A-1: SessionStartフックで workflow が自己同期されたか
セッション開始直後のフック出力に `[team-framework] synced worker-critic.mjs ...` が出るはず。確認：

```bash
ls -l ~/.claude/workflows/worker-critic.mjs   # 同期されていればOK
```

### ✅ Blocker A-2: 同期された workflow が「名前」で解決できるか
Claude に次を依頼：

> Workflow ツールで name: "worker-critic" を実行して。

→ `【...名前解決で起動しました（Blocker A の自己同期経路 OK）】` のログが出れば **A 解決**。

### ✅ Blocker B: 名前空間付き agent type で teammate を spawn できるか（最重要）
Claude に次を依頼（**チームメイトとして**spawnさせるのがポイント。Agentツールのサブエージェントではない）：

> team-framework:planner agent type を使って Planner チームメイトを1体 spawn して。

判定：
- spawnされた本人が `【SPAWN-OK】私は team-framework プラグイン由来の planner です…` を返す → **B 解決（名前空間teammate spawn 可）**
- spawnできない／別物が出る／bare名 `planner` でないと通らない → **B はNG**。本移行プランを「agentsだけグローバル（bare名）に残す折衷」へ再設計する

### （ついで）Blocker C: skill のスラッシュ名前空間
`/team-framework:team` で起動できるか試す → `【SKILL-OK】...` が出れば、本移行での起動名が確定（`/team` ではなく `/team-framework:team`）。

## 結果の記録
3つの結果（A / B / C）をこのセッションに戻って報告 → 結果に応じて本移行プランを確定する。
