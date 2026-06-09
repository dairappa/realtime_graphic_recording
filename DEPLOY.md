# Cloudflare へのデプロイ（最小認証つき）

**Cloudflare Workers（静的アセット配信）** としてデプロイする。1つの Worker が
「静的SPA配信 + Basic 認証 + OpenAI プロキシ」をまとめて担当する。HTTPS が自動で
付くので、Basic 認証もマイク/画面共有(getUserMedia/getDisplayMedia)も安全に動く。

構成:
- `dist/` … Vite ビルド成果物（静的アセット）
- `worker/index.ts` … 全リクエストに Basic 認証 → `/api/openai` は OpenAI へプロキシ → それ以外は `dist` を配信
- `wrangler.toml` … `main`(worker) と `[assets]`(dist) を定義

---

## 認証のしくみ（最小限）

共有のユーザー名/パスワード 1 組だけ。`APP_PASSWORD` を設定すると有効化、
未設定なら認証オフ（ローカル開発用）。`APP_USER` 未指定時は `team`。

| 変数 | 用途 | 必須 |
|---|---|---|
| `APP_PASSWORD` | Basic 認証のパスワード | 認証を有効にするなら必須 |
| `APP_USER` | Basic 認証のユーザー名（既定 `team`） | 任意 |
| `OPENAI_API_KEY` | OpenAI サーバ経由モードを使う場合のみ | 任意 |

---

## いま deploy でコケた人向け（最短復旧）

ビルドは成功し、最後の `wrangler deploy` で
`Missing entry-point to Worker script or to assets directory` が出ていた場合、
このリポジトリの **Workers 構成への修正（`worker/` と `wrangler.toml`）を取り込めば解決** する。

1. この修正を **Cloudflare がビルドしているブランチ（例 `demo`）に反映**する
   （push すれば自動で再デプロイが走る）
2. Worker の **Settings → Variables and Secrets** に `APP_PASSWORD` が入っているか確認
   （無ければ追加して Encrypt → 再デプロイ）

これで `wrangler deploy` が成功し、`https://<worker>.<account>.workers.dev` で開ける。

---

## 方法A: ダッシュボードで Git 連携（推奨・push で自動デプロイ）

1. Cloudflare ダッシュボード → **Workers & Pages → Create**
2. **Import a repository**（Git からインポート）でこのリポジトリを選択
3. ビルド設定:
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`（既定のままでOK）
   - **Production branch**: `demo`（動作確認用に作ったブランチ）
4. **Settings → Variables and Secrets** に登録:
   - `APP_PASSWORD`（Encrypt 推奨）
   - 任意で `APP_USER`、`OPENAI_API_KEY`
5. 保存 → デプロイ。以後は `demo` へ push するたび自動デプロイ。

## 方法B: CLI（wrangler）

```bash
npx wrangler login
npm run deploy   # = npm run build && wrangler deploy

# シークレット設定（Worker 名は wrangler.toml の name）
npx wrangler secret put APP_PASSWORD
npx wrangler secret put APP_USER          # 任意
npx wrangler secret put OPENAI_API_KEY    # 任意

npm run deploy   # 反映のため再デプロイ
```

---

## 動作確認の最短経路（キー不要）

1. デプロイ先 URL を開き、Basic 認証（`APP_USER` / `APP_PASSWORD`）を通過
2. サイドバーは初期値のまま（STT=**Web Speech API**、構造化=**ローカル簡易抽出**）
3. **収録開始** → マイクに話すと、発話がノード化されて tldraw 上に増えていく

→ ここまでは Deepgram も OpenAI も不要で動作確認できる。

## OpenAI をサーバ経由で使う場合

- `OPENAI_API_KEY` を設定してデプロイ
- サイドバーの構造化エンジンを **「OpenAI（サーバ経由・デプロイ時）」** に切替
- ブラウザにキーは載らず、`/api/openai`（Basic 認証で保護）経由で呼ぶ

## ローカルで Worker ごと動かす

```bash
cp .dev.vars.example .dev.vars   # APP_PASSWORD 等を記入
npm run cf:dev                   # = build して wrangler dev
# http://localhost:8788 で Basic 認証つきで確認
```

---

## 補足・既知の制約

- **Deepgram は現状ブラウザ直結**（WebSocket）。本番でキーを隠すには Worker での
  WS プロキシ or 短命キー発行が必要（次フェーズ）。動作確認は Web Speech で完結する。
- Basic 認証は「最小限」。本格運用は **Cloudflare Access（Zero Trust / SSO）** へ
  差し替え推奨（メール認証・無料枠50ユーザー）。
