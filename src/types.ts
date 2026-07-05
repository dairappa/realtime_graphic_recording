// ---- ドメインモデル（PLAN.md §5）----

export type Speaker = 'me' | 'remote'

export type NodeKind = 'topic' | 'point' | 'decision' | 'question' | 'action'

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  speaker?: Speaker
  /** アイコン用キーワード（英語1〜2語）。LLM が提案し、画像生成やemoji選択に使う。 */
  icon?: string
}

export interface GraphEdge {
  id: string
  from: string
  to: string
  label?: string
}

export interface GraphState {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** LLM / Structurer が返す差分パッチ（PLAN.md §4）*/
export interface GraphPatch {
  addNodes?: GraphNode[]
  addEdges?: GraphEdge[]
  updateNodes?: (Pick<GraphNode, 'id'> & Partial<GraphNode>)[]
}

export interface TranscriptSegment {
  text: string
  speaker: Speaker
  ts: number
}

export const emptyGraph = (): GraphState => ({ nodes: [], edges: [] })
