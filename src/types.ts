// ---- ドメインモデル（PLAN.md §5）----

export type Speaker = 'me' | 'remote'

export type NodeKind = 'topic' | 'point' | 'decision' | 'question' | 'action'

export interface GraphNode {
  id: string
  label: string
  kind: NodeKind
  speaker?: Speaker
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
