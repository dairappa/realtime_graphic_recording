import { GraphRenderer } from './canvas/graphRenderer'
import type { IconProvider } from './icons/provider'
import type { SttProvider, SttResult } from './stt/types'
import type { Structurer } from './structure/types'
import { emptyGraph, type GraphNode, type GraphPatch, type GraphState, type Speaker, type TranscriptSegment } from './types'

export interface Source {
  stream: MediaStream
  speaker: Speaker
}

export interface SessionSnapshot {
  savedAt: string
  graph: GraphState
  transcript: TranscriptSegment[]
}

export interface SessionDeps {
  renderer: GraphRenderer
  structurer: Structurer
  /** STT を生成するファクトリ（プロバイダごとに別インスタンスが要る）。 */
  makeStt: () => SttProvider
  /** アイコン解決（省略時はアイコンなし）。非同期経路でノードに描き足す。 */
  iconProvider?: IconProvider
  /** 構造化を流す間隔(ms)。LLM は長め、ローカルは短め。 */
  flushIntervalMs: number
  onTranscript?: (r: SttResult) => void
  onError?: (e: unknown) => void
}

/** 1 回の収録セッション。capture→STT→structurer→renderer を束ねる。 */
export class Session {
  private state: GraphState = emptyGraph()
  private pending: TranscriptSegment[] = []
  private history: TranscriptSegment[] = []
  private stts: SttProvider[] = []
  private timer: number | null = null
  private flushing = false

  constructor(private deps: SessionDeps) {}

  /** 現在のグラフ状態と書き起こし全文（JSONエクスポート用）。 */
  getSnapshot(): SessionSnapshot {
    return {
      savedAt: new Date().toISOString(),
      graph: { nodes: [...this.state.nodes], edges: [...this.state.edges] },
      transcript: [...this.history],
    }
  }

  async start(sources: Source[]) {
    for (const src of sources) {
      const stt = this.deps.makeStt()
      this.stts.push(stt)
      await stt.start(src.stream, src.speaker, (r) => this.onResult(r))
    }
    this.timer = window.setInterval(() => void this.flush(), this.deps.flushIntervalMs)
  }

  private onResult(r: SttResult) {
    this.deps.onTranscript?.(r)
    if (r.isFinal && r.text.trim()) {
      const seg: TranscriptSegment = { text: r.text.trim(), speaker: r.speaker, ts: Date.now() }
      this.pending.push(seg)
      this.history.push(seg)
    }
  }

  private async flush() {
    if (this.flushing || this.pending.length === 0) return
    this.flushing = true
    const batch = this.pending
    this.pending = []
    try {
      const patch = await this.deps.structurer.ingest(batch, this.state)
      this.applyPatch(patch)
    } catch (e) {
      // 失敗したら未処理分を戻して次回リトライ
      this.pending.unshift(...batch)
      this.deps.onError?.(e)
    } finally {
      this.flushing = false
    }
  }

  private applyPatch(patch: GraphPatch) {
    if (patch.addNodes?.length) this.state.nodes.push(...patch.addNodes)
    if (patch.addEdges?.length) this.state.edges.push(...patch.addEdges)
    for (const upd of patch.updateNodes ?? []) {
      const n = this.state.nodes.find((x) => x.id === upd.id)
      if (n) Object.assign(n, upd)
    }
    this.deps.renderer.apply(patch)
    // アイコンは非同期・ベストエフォート（クリティカルパスに載せない: PLAN.md §1）
    for (const node of patch.addNodes ?? []) void this.resolveIcon(node)
  }

  private async resolveIcon(node: GraphNode) {
    const provider = this.deps.iconProvider
    if (!provider) return
    try {
      const icon = await provider.getIcon(node)
      if (icon) this.deps.renderer.applyIcon(node.id, icon)
    } catch {
      /* アイコンは装飾なので失敗しても本編は続行 */
    }
  }

  stop(sources: Source[]) {
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
    this.stts.forEach((s) => s.stop())
    this.stts = []
    sources.forEach((s) => s.stream.getTracks().forEach((t) => t.stop()))
    void this.flush() // 残りを最後に処理
  }
}
