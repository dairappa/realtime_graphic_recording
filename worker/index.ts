/// <reference types="@cloudflare/workers-types" />

// 静的アセット配信 + 最小限の Basic 認証 + OpenAI/Deepgram プロキシ を1つにまとめた Worker。
//
// 環境変数（Cloudflare の Worker 設定 or .dev.vars で指定）:
//   APP_PASSWORD     … Basic 認証パスワード（未設定なら認証オフ）
//   APP_USER         … Basic 認証ユーザー名（既定 "team"）
//   OPENAI_API_KEY   … OpenAI サーバ経由モードを使う場合のみ
//   DEEPGRAM_API_KEY … Deepgram サーバ経由モードを使う場合のみ

interface Env {
  ASSETS: Fetcher
  APP_USER?: string
  APP_PASSWORD?: string
  OPENAI_API_KEY?: string
  DEEPGRAM_API_KEY?: string
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

async function proxyOpenAI(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ error: 'OPENAI_API_KEY 未設定' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const body = await request.text()
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body,
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}

// ---- Deepgram WebSocket 中継 ----------------------------------------------
//
// ブラウザ ⇄ Worker ⇄ Deepgram の双方向リレー。API キーは Worker 内だけで使う。
// WebSocket ハンドシェイクにはブラウザが Basic 認証ヘッダを付けない場合がある
// ため、事前に POST /api/deepgram/ticket（こちらは Basic 認証つき）で短命の
// HMAC チケットを取り、クエリパラメータで渡して認可する。

const TICKET_TTL_MS = 120_000

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function issueTicket(env: Env): Promise<string> {
  const exp = Date.now() + TICKET_TTL_MS
  // 認証オフ運用（APP_PASSWORD 未設定）ではチケットも検証しないため秘密は任意
  const mac = await hmacHex(env.APP_PASSWORD || 'no-auth', String(exp))
  return `${exp}.${mac}`
}

async function verifyTicket(ticket: string | null, env: Env): Promise<boolean> {
  if (!env.APP_PASSWORD) return true // 認証オフなら素通し（ローカル開発用）
  if (!ticket) return false
  const [expStr, mac] = ticket.split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || !mac || Date.now() > exp) return false
  const expected = await hmacHex(env.APP_PASSWORD, expStr)
  return constantTimeEqual(mac, expected)
}

// クライアントから受け付ける Deepgram パラメータ（それ以外は無視）
const DEEPGRAM_ALLOWED_PARAMS = [
  'model',
  'language',
  'interim_results',
  'smart_format',
  'diarize',
  'punctuate',
  'endpointing',
]

async function proxyDeepgram(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket upgrade が必要です', { status: 426 })
  }
  const url = new URL(request.url)
  if (!(await verifyTicket(url.searchParams.get('ticket'), env))) {
    return new Response('チケットが無効です（/api/deepgram/ticket で再取得）', { status: 403 })
  }
  if (!env.DEEPGRAM_API_KEY) {
    return new Response('DEEPGRAM_API_KEY 未設定', { status: 500 })
  }

  const upstreamUrl = new URL('https://api.deepgram.com/v1/listen')
  for (const k of DEEPGRAM_ALLOWED_PARAMS) {
    const v = url.searchParams.get(k)
    if (v !== null) upstreamUrl.searchParams.set(k, v)
  }

  // Workers の外向き WebSocket は fetch + Upgrade ヘッダで張る（サーバ側なので
  // Authorization ヘッダが使える = subprotocol でキーを晒す必要がない）
  const upstreamRes = await fetch(upstreamUrl, {
    headers: {
      Upgrade: 'websocket',
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
    },
  })
  const upstream = upstreamRes.webSocket
  if (!upstream) {
    return new Response(`Deepgram への接続に失敗: ${upstreamRes.status}`, { status: 502 })
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  upstream.accept()
  server.accept()

  // 双方向リレー。どちらかが閉じたら反対側も閉じる。
  server.addEventListener('message', (e) => {
    try {
      upstream.send(e.data)
    } catch {
      /* 送信先が閉じた直後は無視 */
    }
  })
  upstream.addEventListener('message', (e) => {
    try {
      server.send(e.data)
    } catch {
      /* 同上 */
    }
  })
  const closeQuietly = (ws: WebSocket, code: number, reason: string) => {
    try {
      ws.close(code, reason)
    } catch {
      /* 既に閉じている */
    }
  }
  server.addEventListener('close', (e) => closeQuietly(upstream, e.code, e.reason))
  upstream.addEventListener('close', (e) => closeQuietly(server, e.code, e.reason))
  server.addEventListener('error', () => closeQuietly(upstream, 1011, 'client error'))
  upstream.addEventListener('error', () => closeQuietly(server, 1011, 'upstream error'))

  return new Response(null, { status: 101, webSocket: client })
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
        hasOpenaiKey: !!env.OPENAI_API_KEY,
        hasDeepgramKey: !!env.DEEPGRAM_API_KEY,
      })
    }

    // Deepgram 中継（WS ハンドシェイクは Basic ヘッダが載らないことがあるため
    // Basic 認証ゲートより前に置き、短命チケットで認可する）
    if (url.pathname === '/api/deepgram') {
      return proxyDeepgram(request, env)
    }

    // 全リクエストに Basic 認証（run_worker_first=true なので静的アセットも通る）
    if (!isAuthorized(request, env)) return unauthorized()

    if (url.pathname === '/api/deepgram/ticket') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      return Response.json({ ticket: await issueTicket(env), ttlMs: TICKET_TTL_MS })
    }

    if (url.pathname === '/api/openai') {
      if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
      return proxyOpenAI(request, env)
    }

    // それ以外は静的アセット（dist）を配信
    return env.ASSETS.fetch(request)
  },
}
