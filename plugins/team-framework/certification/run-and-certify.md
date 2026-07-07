# モデル差し替え認定の回し方（CERT-001 の実行手順）

モデル構成を変えたら、その席をこのスイートで**認定してから頼る**（自己申告でなく機械照合）。詳細な採点規則は各スイートの README / ANSWER-KEY を参照。ここは「いつ・どれを・合格線」の運用ラッパ。

## いつ回すか
- fable 停止で **Critic/Planner が opus にフォールバック**するようになったとき → opus を**ゲート役**として認定（`gate-suite`）。
- 新モデルを Worker/ゲートに投入するとき → その役割のスイートで認定。
- 差し替え時のみ・有界コスト。

## どれを回すか（役割別）
| 認定したい席 | スイート | 合格線 |
|---|---|---|
| Critic（検証ゲート） | `gate-suite`（必要なら `gate-suite-hard`） | 欠陥で **MISS=0** かつ clean で **FALSE-ALARM=0**（感度と特異度の両立） |
| Worker（生成モードの自己検証） | `generation-mode` | スイートの ANSWER-KEY 規則に従う |
| reasoning/数値の検証行動 | `truth-anchored`（`score.mjs` で judge不要採点） | ANSWER-KEY 通り |

## 回し方（gate-suite の例）
1. `gate-suite/harness.mjs` を `Workflow({ scriptPath, args })` で起動。`args = { skillA: "", packets: [{id, text}...], runs: 3 }`。**packet は inline で渡す**（被験にリポジトリ探索をさせない＝リーク防止。tool_uses が agent 数の約1倍なら探索していない傍証）。
2. **1本ずつ独立コンテキスト**で投入（鏡像ペアの相互リーク防止）。
3. 各 verdict を `ANSWER-KEY.md` の採点規則で機械照合。**MISS=0 かつ FALSE-ALARM=0 で認定**。

## 鉄則（この framework 共通）
- **自己申告を信じない**：認定は harness の生 verdict を ANSWER-KEY と機械照合して出す。
- **難度予測は継承しない**：スイート拡張時は ANSWER-KEY の「正解verdict」だけ継承し「想定難度」は立て直す（設計者自身が難度予測を系統的に外した実績。予測盲信＝このゲートが検出したい失敗そのもの）。
- **実測の参考値**（gate-suite README より）: 小パケット・レビューモードでは opus も sonnet も MISS=0（閉ループに落ちない）。**弱いモデル(sonnet)の失敗はむしろ過剰棄却(FALSE-ALARM)側**（T5=3回とも棄却）。∴ 認定は感度(MISS)だけでなく**特異度(FALSE-ALARM)も必ず見る**。
