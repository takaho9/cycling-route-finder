# バックログ（批判レビュー #1 を受けた PdM 判断）

## PdM判断
- **静的POIタイル化（ビルド時にOSM抽出）**: v1では見送り（ビルドパイプラインとデータ量のコスト大）。Overpass + 強めのキャッシュで行く。v2候補。
- **時間の約束**: 「走行時間の目安」（滞在含まず）と明記。距離帯の内径は 0.7。上りペナルティ（往復獲得標高10mごとに+0.5分）。経路検証は詳細表示時のみ。経路距離が帯上限×1.2超なら警告＋時間を経路ベースに置換。
- **提案型を主役にする**: 一覧の最上部に「今日のおすすめ3件」（大カード、カードから直接「出発」= 2タップ）。残りは「もっと見る」で一覧。おすすめは日付シード＋未訪問加点で日替わり。
- **天気**: v1では見送り。**日没までの残り時間**はローカル計算（API不要）でv1に入れる（ホームに「日没まであと◯分」、日没後に帰着しそうなら注意）。

## v1 必須（開発者対応）
- R1 高低差判定を PdM 決定式に（G=max(往路上り,復路上り), R=G/片道km, 🔴 R≥15|G≥150|最大勾配≥8%, 🟡 R≥6|G≥40）。勾配は100m以上の窓で平滑化。noiseThresholdM 既定3m。境界値テスト。
- R2 モックは `?demo=1` か全プロバイダ失敗時のみ。結果型を `ok | empty | error | demo` で区別、UIで出し分け。
- R3 ルーティング: routing.openstreetmap.de/routed-bike（パス形式は driving プロファイル名で投げる版も試すフォールバック）→ 直線。詳細表示時のみ・キャッシュ。経路で再計算した場合は一覧のラベルも更新。
- R4 Googleマップ URL: 片道は origin 省略 + `dir_action=navigate`。往復は origin 省略、destination=出発地、waypoints=目的地。代替「徒歩で開く」リンク。`<a href target="_blank" rel="noopener">` で遷移（window.open に頼らない）。
- R5 一覧の直線標高サンプルで海上(<=0m)が連続する候補は順位を下げる。詳細の経路距離チェック（上記）。
- R6 Overpass: 現在速度での最大時間(90分)半径で1回取得 → 時間チップ切替はクライアント側フィルタのみ。in-flight Promise 共有。1本目タイムアウト10秒。way/relation は `out tags center`。429/504は同一エンドポイント即リトライしない。結果を localStorage にTTL24h（座標は小数3桁に丸めてキー化）。
- R7 Maps 起動時に「出発記録（placeId, 名前, 時刻, 予定分）」を保存 → 次回起動時、出発から(予定分×0.5)〜12時間なら最上部に「◯◯行ってきた？ ✓走った / ✕行かなかった」カード。removeRide、longestStreak、Settings.weeklyGoal（既定3）。
- R8 クレジット表示（© OpenStreetMap contributors / Elevation: Open-Meteo (CC BY 4.0) / Routing: FOSSGIS / 写真: Wikimedia Commons＋作者・ライセンス（extmetadata））。出発地の手動指定は「地図中心ピン」or「確定時のみ Nominatim 検索（入力補完禁止、1秒1件）」。
- Y1 候補の質: 公園は対角400m以上 or wikidata/heritage付き。brand付きカフェ/ベーカリーは除外。place_of_worship は religion=shinto/buddhist のみ。重複排除は「同名かつ300m以内」。見栄えスコア（wikidata, 面積, heritage, 写真有）で選抜。
- Y5 写真: wbgetentities で最大50件バッチ。image タグは wikimedia/commons ドメインのみ許可。img に referrerpolicy="no-referrer", loading="lazy"。
- Y6 位置情報拒否時は自動で東京駅検索しない → 出発地選択を先に出す（「デモで試す（東京駅）」ボタンはあり）。精度>500mで注意。外部送信座標は小数3〜4桁に丸め。
- Y8 オフライン: 最後の検索結果を localStorage に保存して表示。
- Y9 標高はバッチ単位の部分成功、abort時は例外、欠損点は除外して距離を正しく扱う。
- Y10 カテゴリ定義はコード側を正とし、DESIGN の表と揃える（seaside/museum/sweets も含めて整理）。
- Y11 way は center を使う。
- G2 vitest で TZ=Asia/Tokyo 固定、深夜0〜4時のライドは前日扱い。
- G3 テスト追加（判定境界、URL、in-flight共有、way/relation、ラベル整合）。`npm run test:live`（実API任意スモーク、CIでは実行しない）。

## v2 候補
- 静的POIタイル、天気（Open-Meteo forecast）、プロバイダ横断の訪問済み照合
