/// <reference types="@cloudflare/workers-types" />

// Claude(Anthropic) Messages API への薄いプロキシ。
// ブラウザは API キーを持たず、このエンドポイント越しに呼ぶ。
// キーは Cloudflare のシークレットで設定:
//   wrangler pages secret put ANTHROPIC_API_KEY
//
// 認証は _middleware.ts の Basic 認証で全体に掛かっている。

interface Env {
  ANTHROPIC_API_KEY?: string
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  if (!ctx.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY 未設定' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = await ctx.request.text()
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ctx.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body,
  })

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}
