# Cloudflare Pages へのデプロイ（最小認証つき）

静的SPA（Vite）＋ Pages Functions（Basic 認証 / Claude プロキシ）を
Cloudflare Pages にデプロイする手順。**HTTPS が自動で付く**ので、
Basic 認証のパスワードもマイク/画面共有(getUserMedia/getDisplayMedia)も安全に動く。

構成:
- `dist/` … Vite ビルド成果物（静的アセット）
- `functions/_middleware.ts` … **全ルートに Basic 認証**
- `functions/api/anthropic.ts` … Claude へのプロキシ（キーをサーバ秘匿）

---

## 認証のしくみ（最小限）

共有のユーザー名/パスワード 1 組だけ。`APP_PASSWORD` を設定すると有効化、
未設定なら認証オフ（ローカル開発用）。`APP_USER` 未指定時は `team`。

| 変数 | 用途 | 必須 |
|---|---|---|
| `APP_PASSWORD` | Basic 認証のパスワード | 認証を有効にするなら必須 |
| `APP_USER` | Basic 認証のユーザー名（既定 `team`） | 任意 |
| `ANTHROPIC_API_KEY` | Claude サーバ経由モードを使う場合のみ | 任意 |

---

## 方法A: ダッシュボードで Git 連携（推奨・push で自動デプロイ）

1. Cloudflare ダッシュボード → **Workers & Pages → Create → Pages → Connect to Git**
2. このリポジトリを選択し、ビルド設定:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - （Functions は `functions/` を自動検出）
3. **Settings → Variables and Secrets** に登録:
   - `APP_PASSWORD`（Secret） … 任意の共有パスワード
   - 任意で `APP_USER`、`ANTHROPIC_API_KEY`
4. 保存して **Deploy**。以後は対象ブランチへ push するたび自動デプロイ。

## 方法B: CLI（wrangler）

```bash
# 1) ログイン（ブラウザが開く）
npx wrangler login

# 2) ビルド＆初回デプロイ（プロジェクトが無ければ作成される）
npm run deploy        # = npm run build && wrangler pages deploy

# 3) シークレットを設定（プロジェクト名は wrangler.toml の name）
npx wrangler pages secret put APP_PASSWORD   --project-name realtime-graphic-recording
npx wrangler pages secret put APP_USER       --project-name realtime-graphic-recording   # 任意
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name realtime-graphic-recording # 任意

# 4) シークレット反映のため再デプロイ
npm run deploy
```

デプロイ後、`https://<project>.pages.dev` を開くと Basic 認証のダイアログが出る。
`APP_USER` / `APP_PASSWORD` を入力すればアプリが表示される。

---

## 動作確認の最短経路（キー不要）

1. デプロイ先 URL を開き、Basic 認証を通過
2. サイドバーは初期値のまま（STT=**Web Speech API**、構造化=**ローカル簡易抽出**）
3. **収録開始** → マイクに話すと、発話がノード化されて tldraw 上に増えていく

→ ここまでは Deepgram も Claude も不要で動作確認できる。

## Claude をサーバ経由で使う場合

- `ANTHROPIC_API_KEY` を設定してデプロイ
- サイドバーの構造化エンジンを **「Claude（サーバ経由・デプロイ時）」** に切替
- ブラウザにキーは載らず、`/api/anthropic`（Basic 認証で保護）経由で呼ぶ

## ローカルで Functions ごと動かす

```bash
cp .dev.vars.example .dev.vars   # APP_PASSWORD 等を記入
npm run cf:dev                   # = build して wrangler pages dev
# http://localhost:8788 で Basic 認証つきで確認
```

---

## 補足・既知の制約

- **Deepgram は現状ブラウザ直結**（WebSocket）。本番でキーを隠すには Worker での
  WS プロキシ or 短命キー発行が必要（次フェーズ）。動作確認は Web Speech で完結する。
- Basic 認証は「最小限」。本格運用は **Cloudflare Access（Zero Trust / SSO）** へ
  差し替え推奨（メール認証・無料枠50ユーザー）。`_middleware.ts` を外すだけで両立可。
