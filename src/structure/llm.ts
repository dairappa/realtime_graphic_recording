import type { GraphPatch, GraphState, TranscriptSegment } from '../types'
import type { Structurer } from './types'

const SYSTEM = `あなたは会議のグラフィックレコーディングを支援するエンジンです。
直近の発話と、現在のグラレコ状態(JSON)を受け取り、状態への「差分パッチ」だけを返します。
論点・主張・決定・質問・アクションを抽出し、既存ノードと関連づけてください。
出力は次の形の JSON のみ（前後の説明やコードフェンス無し）:
{"addNodes":[{"id":"一意ID","label":"短い見出し","kind":"topic|point|decision|question|action","speaker":"me|remote"}],
 "addEdges":[{"id":"一意ID","from":"ノードID","to":"ノードID","label":"任意"}],
 "updateNodes":[{"id":"既存ID","label":"更新後"}]}
新規IDは必ずユニークに。既存ノードと重複する話題は addNodes せず updateNodes か addEdges で繋ぐこと。`

/**
 * Claude を使う差分 Structurer（PLAN.md §4）。任意・キー必要。
 * ⚠️ 本番では Cloudflare Worker 経由にしてキーを秘匿すること。
 * ここは anthropic-dangerous-direct-browser-access でローカル検証する直結実装。
 */
export class LlmStructurer implements Structurer {
  constructor(
    private apiKey: string,
    private model = 'claude-sonnet-4-6',
  ) {}

  async ingest(segments: TranscriptSegment[], state: GraphState): Promise<GraphPatch> {
    const transcript = segments.map((s) => `[${s.speaker}] ${s.text}`).join('\n')
    const userContent =
      `## 現在のグラレコ状態\n${JSON.stringify(state)}\n\n## 直近の発話\n${transcript}`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      }),
    })
    if (!res.ok) throw new Error(`Claude API エラー: ${res.status} ${await res.text()}`)

    const data = await res.json()
    const text: string = data.content?.[0]?.text ?? '{}'
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
