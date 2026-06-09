/// <reference types="@cloudflare/workers-types" />

// 静的アセット配信 + 最小限の Basic 認証 + Claude プロキシ を1つにまとめた Worker。
// （旧 functions/_middleware.ts と functions/api/anthropic.ts を統合）
//
// 環境変数（Cloudflare の Worker 設定 or .dev.vars で指定）:
//   APP_PASSWORD      … Basic 認証パスワード（未設定なら認証オフ）
//   APP_USER          … Basic 認証ユーザー名（既定 "team"）
//   ANTHROPIC_API_KEY … Claude サーバ経由モードを使う場合のみ

interface Env {
  ASSETS: Fetcher
  APP_USER?: string
  APP_PASSWORD?: string
  ANTHROPIC_API_KEY?: string
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.APP_PASSWORD) return true // 未設定なら認証オフ（ローカル開発用）
  const expectedUser = env.APP_USER || 'team'
  const header = request.headers.get('Authorization') || ''
  const [scheme, encoded] = header.split(' ')
  if (scheme !== 'Basic' || !encoded) return false
  let decoded = ''
  try {
    decoded = atob(encoded)
  } catch {
    return false
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return false
  const user = decoded.slice(0, idx)
  const pass = decoded.slice(idx + 1)
  return constantTimeEqual(user, expectedUser) && constantTimeEqual(pass, env.APP_PASSWORD)
}

function unauthorized(): Response {
  return new Response('認証が必要です', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="grareco-live", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}

async function proxyAnthropic(request: Request, env: Env): Promise<Response> {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY 未設定' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const body = await request.text()
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // 診断用: 実行時 env にシークレットが届いているかを確認する（値は返さない）。
    // 確認が済んだら削除してよい。
    if (url.pathname === '/api/_authcheck') {
      return Response.json({
        hasPassword: !!env.APP_PASSWORD,
        user: env.APP_USER || 'team (default)',
        hasAnthropicKey: !!env.ANTHROPIC_API_KEY,
      })
    }

    // 全リクエストに Basic 認証（run_worker_first=true なので静的アセットも通る）
    if (!isAuthorized(request, env)) return unauthorized()

    if (url.pathname === '/api/anthropic') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      return proxyAnthropic(request, env)
    }

    // それ以外は静的アセット（dist）を配信
    return env.ASSETS.fetch(request)
  },
}
