import type { GraphNode, GraphPatch, GraphState, NodeKind, TranscriptSegment } from '../types'
import type { Structurer } from './types'

let seq = 0
const nid = () => `n${Date.now().toString(36)}_${seq++}`
const eid = () => `e${Date.now().toString(36)}_${seq++}`

/** ごく簡単なキーワード抽出（カタカナ語・漢字熟語・英単語を拾う）。 */
function extractKeyword(text: string): string | undefined {
  const m =
    text.match(/[ァ-ヶー]{3,}/) || // カタカナ語
    text.match(/[一-龠々]{2,}/) || // 漢字熟語
    text.match(/[A-Za-z][A-Za-z0-9]{2,}/) // 英単語
  return m?.[0]
}

/** 発話の種類を簡易ルールで分類。 */
function classify(text: string): NodeKind {
  if (/[?？]|でしょうか|ますか|どう(です|思)/.test(text)) return 'question'
  if (/決(定|め|まり)|合意|結論|GO|ゴー/.test(text)) return 'decision'
  if (/やる|対応|タスク|TODO|担当|までに|期限/.test(text)) return 'action'
  if (extractKeyword(text)) return 'topic'
  return 'point'
}

/**
 * キー不要のローカル Structurer。
 * 確定した発話ごとに 1 ノードを作り、直前ノードへ時系列リンクを張る。
 * → LLM 無しでも「育つキャンバス」のループを体験できる。
 */
export class HeuristicStructurer implements Structurer {
  private lastNodeId: string | null = null

  async ingest(segments: TranscriptSegment[], _state: GraphState): Promise<GraphPatch> {
    const addNodes: GraphNode[] = []
    const addEdges: GraphPatch['addEdges'] = []

    for (const seg of segments) {
      const text = seg.text.trim()
      if (!text) continue
      const kw = extractKeyword(text)
      const id = nid()
      addNodes.push({
        id,
        label: kw ? `${kw}\n${truncate(text)}` : truncate(text),
        kind: classify(text),
        speaker: seg.speaker,
      })
      if (this.lastNodeId) {
        addEdges!.push({ id: eid(), from: this.lastNodeId, to: id })
      }
      this.lastNodeId = id
    }

    return { addNodes, addEdges }
  }
}

function truncate(s: string, n = 40): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
