import type { GraphPatch, GraphState, TranscriptSegment } from '../types'
import type { Structurer } from './types'

const SYSTEM = `あなたは会議のグラフィックレコーディングを支援するエンジンです。
直近の発話と、現在のグラレコ状態(JSON)を受け取り、状態への「差分パッチ」だけを返します。
論点・主張・決定・質問・アクションを抽出し、既存ノードと関連づけてください。
出力は次の形の JSON のみ（前後の説明やコードフェンス無し）:
{"addNodes":[{"id":"一意ID","label":"短い見出し","kind":"topic|point|decision|question|action","speaker":"me|remote","icon":"英語1-2語"}],
 "addEdges":[{"id":"一意ID","from":"ノードID","to":"ノードID","label":"任意"}],
 "updateNodes":[{"id":"既存ID","label":"更新後"}]}
icon はノード内容を絵にするための英語キーワード（例 "budget", "rocket launch"）。
新規IDは必ずユニークに。既存ノードと重複する話題は addNodes せず updateNodes か addEdges で繋ぐこと。`

export interface LlmStructurerOptions {
  /** ブラウザ直結モードの API キー（ローカル検証用）。 */
  apiKey?: string
  /** サーバプロキシのエンドポイント（本番。例: /api/openai）。指定時はキー不要。 */
  endpoint?: string
  /** OpenAI のモデル。コスト重視なら gpt-4o-mini が手頃。 */
  model?: string
}

/**
 * OpenAI を使う差分 Structurer（PLAN.md §4）。
 *
 * 2 モード:
 *  - endpoint 指定: Cloudflare Worker 経由（キーはサーバ秘匿）← 本番推奨
 *  - apiKey 指定:   ブラウザ直結（ローカル検証用。キーが露出する点に注意）
 */
export class LlmStructurer implements Structurer {
  private apiKey?: string
  private endpoint?: string
  private model: string

  constructor(opts: LlmStructurerOptions) {
    this.apiKey = opts.apiKey
    this.endpoint = opts.endpoint
    this.model = opts.model ?? 'gpt-4o-mini'
  }

  async ingest(segments: TranscriptSegment[], state: GraphState): Promise<GraphPatch> {
    const transcript = segments.map((s) => `[${s.speaker}] ${s.text}`).join('\n')
    const userContent =
      `## 現在のグラレコ状態\n${JSON.stringify(state)}\n\n## 直近の発話\n${transcript}`

    const payload = {
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    }

    const res = this.endpoint
      ? await fetch(this.endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include', // Basic 認証クレデンシャルを同送
          body: JSON.stringify(payload),
        })
      : await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey ?? ''}`,
          },
          body: JSON.stringify(payload),
        })
    if (!res.ok) throw new Error(`OpenAI API エラー: ${res.status} ${await res.text()}`)

    const data = await res.json()
    const text: string = data.choices?.[0]?.message?.content ?? '{}'
    return parsePatch(text)
  }
}

function parsePatch(text: string): GraphPatch {
  try {
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    const p = JSON.parse(json)
    return {
      addNodes: p.addNodes ?? [],
      addEdges: p.addEdges ?? [],
      updateNodes: p.updateNodes ?? [],
    }
  } catch {
    return {}
  }
}
