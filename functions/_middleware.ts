/// <reference types="@cloudflare/workers-types" />

// 全ルートに最小限の Basic 認証をかける Pages Functions ミドルウェア。
// 共有ユーザー名/パスワードを Cloudflare のシークレットで設定する:
//   wrangler pages secret put APP_PASSWORD
//   （任意）wrangler pages secret put APP_USER   ※未設定なら "team"
//
// APP_PASSWORD が未設定のときは認証を無効化して素通し（ローカル開発用）。

interface Env {
  APP_USER?: string
  APP_PASSWORD?: string
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, next } = ctx

  // パスワード未設定なら認証オフ（ローカル開発の利便のため）
  if (!env.APP_PASSWORD) return next()

  const expectedUser = env.APP_USER || 'team'
  const header = request.headers.get('Authorization') || ''
  const [scheme, encoded] = header.split(' ')

  if (scheme === 'Basic' && encoded) {
    let decoded = ''
    try {
      decoded = atob(encoded)
    } catch {
      decoded = ''
    }
    const idx = decoded.indexOf(':')
    if (idx >= 0) {
      const user = decoded.slice(0, idx)
      const pass = decoded.slice(idx + 1)
      if (constantTimeEqual(user, expectedUser) && constantTimeEqual(pass, env.APP_PASSWORD)) {
        return next()
      }
    }
  }

  return new Response('認証が必要です', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="grareco-live", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
    },
  })
}
