#!/usr/bin/env bash
# team-framework SessionStart hook
# ----------------------------------------------------------------------------
# 目的: worktree隔離(worker-critic.mjs の worktree:true / isolation:"worktree")を
#       「現在のローカルHEAD」基点で作らせる。
#
# 背景: Claude Code の worktree はデフォルトで origin/HEAD(=リモート既定ブランチ)から
#       分岐するため、ローカルで進めた未pushコミットが隔離worktreeに反映されない。
#       公式設定 worktree.baseRef="head" で「ローカルHEAD基点」に切り替わる
#       （値は "fresh" | "head" の二択。cf. code.claude.com/docs/en/worktrees）。
#       このフックはそれをプロジェクトの settings.local.json に自動注入する。
#
# 方針(安全側):
#   - 書き込み先は .claude/settings.local.json のみ(個人スコープ/gitignore想定)。
#     チーム共有の settings.json やユーザーグローバル設定は触らない。
#   - 既に worktree.baseRef が設定済みなら尊重して何もしない(冪等)。
#   - jq が無ければ静かにスキップ。どの失敗でもセッションは壊さない(常に exit 0)。
# ----------------------------------------------------------------------------
set -u

DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
SETTINGS="$DIR/.claude/settings.local.json"

# jq が無ければスキップ(セッションを壊さない)
if ! command -v jq >/dev/null 2>&1; then
  echo "[team-framework] jq未検出のため worktree.baseRef の自動設定をスキップ"
  exit 0
fi

mkdir -p "$DIR/.claude" 2>/dev/null || exit 0

# 既存が妥当なJSONならそれを土台に、そうでなければ空オブジェクトから
if [ -s "$SETTINGS" ] && jq -e . "$SETTINGS" >/dev/null 2>&1; then
  BASE=$(cat "$SETTINGS")
else
  BASE='{}'
fi

# 既に worktree.baseRef があるなら尊重して終了(ユーザー設定を上書きしない)
if printf '%s' "$BASE" | jq -e 'has("worktree") and (.worktree|type=="object") and (.worktree|has("baseRef"))' >/dev/null 2>&1; then
  exit 0
fi

# worktree.baseRef="head" を注入(他キーは保持)。一時ファイル経由で原子的に置換
NEW=$(printf '%s' "$BASE" | jq '.worktree = ((.worktree // {}) + {baseRef:"head"})') || exit 0
TMP="$SETTINGS.tmp.$$"
if printf '%s\n' "$NEW" > "$TMP" 2>/dev/null && mv "$TMP" "$SETTINGS" 2>/dev/null; then
  echo "[team-framework] set worktree.baseRef=head in .claude/settings.local.json (worktree隔離をローカルHEAD基点に)"
else
  rm -f "$TMP" 2>/dev/null
fi
exit 0
