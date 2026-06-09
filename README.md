# リアルタイム・グラフィックレコーディング（Phase 0 プロト）

会議・ワークショップの音声をリアルタイムに書き起こし、AI で論点を構造化して
**tldraw キャンバス上に「育つグラレコ」**として描画する Web アプリ。

設計の全体像・技術選定は [`PLAN.md`](./PLAN.md)、
Cloudflare へのデプロイ（最小認証つき）は [`DEPLOY.md`](./DEPLOY.md) を参照。

## このプロトでできること

- tldraw キャンバスへ、発話を逐次ノード化して描画（時系列リンク）
- 音声取込: マイク（自分）＋ 相手の声（画面共有タブ音声 / 仮想オーディオデバイス）
- STT: **Web Speech API（無料・キー不要）** / Deepgram（要キー・相手の声も対応）
- 構造化: **ローカル簡易抽出（キー不要）** / OpenAI（要キー・差分構造化）

> **すぐ試す最短経路**: STT=Web Speech、構造化=キー無し（ローカル）。
> Chrome で開いてマイクに話すと、発話がノードになって増えていきます。

## 起動

```bash
npm install
npm run dev
```

ブラウザ（Chrome 推奨）で http://localhost:5173 を開く。

## モード早見

| やりたいこと | STT | 相手の声 |
|---|---|---|
| まず動かす（自分の声だけ） | Web Speech | — |
| Google Meet 等ブラウザ会議 | Deepgram | ① 画面共有のタブ音声 |
| Zoom/Teams デスクトップアプリ | Deepgram | ② 仮想デバイス（BlackHole / VB-Cable） |

### 仮想オーディオデバイス（モード②）の準備

1. **macOS**: BlackHole を入れ、「Audio MIDI 設定」で *複数出力装置*
   （BlackHole + 実スピーカー）を作り、Zoom の出力をそれに向ける（音を聞き続けるため）。
2. **Windows**: VB-Cable を入れ、「このデバイスを聴く」で実スピーカーへ転送。
3. アプリのサイドバーで、相手の声の入力として仮想デバイスを選択。

## デプロイ（Cloudflare Workers・最小認証つき）

1つの Worker が「静的SPA配信 + Basic 認証 + OpenAI プロキシ」を担当する。
全ルートに Basic 認証（共有パスワード1つ）を掛けた状態で公開できる。
手順は [`DEPLOY.md`](./DEPLOY.md)。最短はダッシュボードの Git 連携で
Build command `npm run build` / Deploy command `npx wrangler deploy`、
Secret に `APP_PASSWORD` を設定。

## 構成

```
src/
  audio/capture.ts        # 2 ストリーム取得（mic / display / 仮想デバイス）
  stt/                    # SttProvider: webSpeech.ts / deepgram.ts
  structure/              # Structurer: heuristic.ts / llm.ts(OpenAI: 直結/サーバ経由)
  canvas/graphRenderer.ts # GraphPatch → tldraw シェイプ
  session.ts              # capture→STT→structurer→renderer の束ね
  App.tsx                 # UI
worker/
  index.ts                # 静的配信 + Basic認証 + OpenAIプロキシ(/api/openai)
wrangler.toml             # main(worker) + [assets](dist)
```

## 注意（プロト段階）

- API キーは検証用にブラウザ直結。**本番は Cloudflare Worker でプロキシしてキーを秘匿**すること。
- Web Speech API は任意ストリームを扱えず、OS 既定入力のみ書き起こす（相手の声は Deepgram で）。
