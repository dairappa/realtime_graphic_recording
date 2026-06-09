# リアルタイム・グラフィックレコーディング — プラン & スペック

会議・ワークショップの音声をリアルタイムに書き起こし、AIで論点を構造化して
tldraw キャンバス上に「育つグラレコ」として描画する Web アプリ。

## 1. 全体アーキテクチャ

```
🎤 マイク (getUserMedia)        ─┐
🔊 相手の声 (getDisplayMedia /   ├─ ② STT (ストリーミング) ─→ 書き起こしテキスト
   仮想オーディオデバイス)      ─┘        │  ※ 2系統 = チャンネルが話者分離の代わり
                                          ▼
                            ③ 構造化 LLM（差分グラレコ設計）
                               入力 = 直近チャンク + 現在のグラレコ状態(JSON)
                               出力 = 追記/修正パッチ(JSON)
                                          ▼
                            ④ tldraw レンダラ（ノード/エッジを逐次配置）
                                          ▼
                                🎨 リアルタイムに育つキャンバス
```

非同期・別経路（クリティカルパスに載せない）:

```
④の「どのアイコンを使うか」指示 ─→ 画像生成(Gemini画像 / GPT Image)
                                  ─→ アイコン素材を生成しキャッシュ＆再利用
```

## 2. 技術選定（確定方針）

| レイヤー | 採用 | 理由 |
|---|---|---|
| フロント | React + Vite + TypeScript | 軽量・tldraw と好相性 |
| 描画 | **tldraw** | 手書き風・編集可能・逐次追記に強い |
| 音声取込 | getUserMedia / getDisplayMedia / 仮想デバイス | 下記キャプチャ層参照 |
| STT | **Deepgram** ストリーミング（×2系統） | 高精度・低遅延・話者分離つきで激安 |
| STT(プロト) | Web Speech API | 無料・キー不要（デフォルト入力のみ） |
| 構造化 | **OpenAI (gpt-4o-mini)**（差し替え可） | JSON mode で構造化出力 / 差分設計でトークン節約 |
| 画像素材 | Gemini画像 / GPT Image（**非同期・キャッシュ**） | "映え"担保。リアルタイム経路には載せない |
| 中継 | Cloudflare Workers + Durable Objects | WebSocket常駐を安価に・APIキー秘匿プロキシ |
| ホスト | Cloudflare Pages | 無料枠 |

**月間コスト目安**（週5×1h ≒ 月20h）: STT 約150円 + LLM 数百円 + ホストほぼ無料
→ ざっくり **月500〜1,500円規模**。

## 3. キャプチャ層（設計の主役）

マイクとスピーカーは **混ぜず 2 ストリームで取得** し、チャンネルを話者分離に使う。

| モード | 相手の声の取り方 | 対象 | 備考 |
|---|---|---|---|
| ① ブラウザ会議 | `getDisplayMedia({audio:true})` タブ音声 | Google Meet 等 | Chrome前提・mac もタブ音声はOK |
| ② デスクトップアプリ | **仮想オーディオデバイス**(BlackHole / VB-Cable) を入力選択 | **Zoom/Teams アプリ** | 全アプリ対応・要セットアップ |

仮想デバイスのストリームは **echoCancellation / noiseSuppression / autoGainControl を OFF**
（会議の複数人音声に音声処理を掛けると劣化するため。マイク側は ON のまま）。

## 4. 差分グラレコ設計（コストの肝）

全文を毎回投げず、30〜60秒チャンクごとに「直近の発話 + 現在のグラレコ状態」を渡し、
**追記/修正パッチ(JSON)** を返させる。これでトークン代を桁で削減。

```jsonc
// LLM 出力パッチの例
{
  "addNodes":   [{ "id": "n12", "label": "予算配分", "kind": "topic", "speaker": "remote" }],
  "addEdges":   [{ "from": "n8", "to": "n12", "label": "に関連" }],
  "updateNodes":[{ "id": "n8", "label": "Q3 ロードマップ（更新）" }]
}
```

## 5. データモデル

```ts
type NodeKind = 'topic' | 'point' | 'decision' | 'question' | 'action'
interface GraphNode { id: string; label: string; kind: NodeKind; speaker?: string }
interface GraphEdge { id: string; from: string; to: string; label?: string }
interface GraphState { nodes: GraphNode[]; edges: GraphEdge[] }
interface GraphPatch { addNodes?; addEdges?; updateNodes? }
```

## 6. 差し替え可能インターフェース（ベンダーロック回避）

```ts
interface SttProvider  { start(stream, onResult): Promise<void>; stop(): void }
interface Structurer   { ingest(segment, state): Promise<GraphPatch> }
```

STT も Structurer も実装を差し替え可能に。プロキシ(Worker)越しにキーを秘匿。

## 7. 段階導入ロードマップ

- **Phase 0（このプロト）**: Web版で tldraw に「育つキャンバス」を可視化
  - 音声取込（mic + display + デバイス選択）/ STT（Web Speech, Deepgram差込）/
    構造化（ローカル簡易, LLM差込）/ tldraw 描画
  - **キー不要で即動く**よう、デフォルトは Web Speech API + ローカル構造化
- **Phase 1**: Deepgram 2系統 + OpenAI 差分構造化を Worker 経由で接続
- **Phase 2**: 画像生成によるアイコン素材の非同期生成＆キャッシュ
- **Phase 3**: Electron 化で仮想デバイス不要のシステム音取込（ScreenCaptureKit / WASAPI）

## 8. このプロトのスコープ（Phase 0）

含む:
- tldraw キャンバスと逐次レンダリング（ノード=geo shape、エッジ=arrow、自動レイアウト）
- 音声デバイス列挙 + マイク/相手 2系統の取得 UI（モード①②トグル）
- Web Speech API による書き起こし（デフォルト・キー不要）
- ローカル簡易 Structurer（キーワード抽出でノード化）+ LLM Structurer の差込口
- 差分パッチ → GraphState → tldraw 反映

含まない（後続フェーズ）:
- Deepgram 実接続 / Cloudflare デプロイ / 画像生成 / 共同編集同期 / 永続化
