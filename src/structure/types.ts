import type { GraphPatch, GraphState, TranscriptSegment } from '../types'

/** 構造化エンジンの差し替え可能インターフェース（PLAN.md §6）。
 *  「直近の発話 + 現在のグラレコ状態」を受け取り、差分パッチを返す。 */
export interface Structurer {
  ingest(segments: TranscriptSegment[], state: GraphState): Promise<GraphPatch>
}
