import { type Editor, type TLShapeId, createShapeId, toRichText } from 'tldraw'
import type { GraphPatch, NodeKind, Speaker } from '../types'

const NODE_W = 220
const NODE_H = 84
const COL_GAP = 260
const LANE_Y: Record<Speaker, number> = { me: 0, remote: 360 }

const KIND_COLOR: Record<NodeKind, string> = {
  topic: 'blue',
  point: 'black',
  decision: 'green',
  question: 'orange',
  action: 'violet',
}

interface Placed {
  x: number
  y: number
}

/**
 * GraphPatch を tldraw キャンバスへ逐次反映するレンダラ。
 * ノード = geo 矩形（話者でレーン分け）、エッジ = arrow。
 */
export class GraphRenderer {
  private placed = new Map<string, Placed>()
  private laneCount: Record<Speaker, number> = { me: 0, remote: 0 }

  constructor(private editor: Editor) {}

  apply(patch: GraphPatch) {
    let newest: Placed | null = null

    for (const node of patch.addNodes ?? []) {
      if (this.placed.has(node.id)) continue
      const speaker: Speaker = node.speaker ?? 'me'
      const x = this.laneCount[speaker] * COL_GAP
      const y = LANE_Y[speaker]
      this.laneCount[speaker]++

      const id = createShapeId(node.id)
      this.editor.createShape({
        id,
        type: 'geo',
        x,
        y,
        props: {
          geo: 'rectangle',
          w: NODE_W,
          h: NODE_H,
          color: KIND_COLOR[node.kind] as any,
          size: 's',
          richText: toRichText(node.label),
        },
      })
      this.placed.set(node.id, { x, y })
      newest = { x, y }
    }

    for (const edge of patch.addEdges ?? []) {
      const from = this.placed.get(edge.from)
      const to = this.placed.get(edge.to)
      if (!from || !to) continue
      const id = createShapeId(edge.id)
      if (this.editor.getShape(id)) continue
      this.editor.createShape({
        id,
        type: 'arrow',
        x: 0,
        y: 0,
        props: {
          start: { x: from.x + NODE_W / 2, y: from.y + NODE_H / 2 },
          end: { x: to.x + NODE_W / 2, y: to.y + NODE_H / 2 },
          color: 'grey' as any,
          ...(edge.label ? { richText: toRichText(edge.label) } : {}),
        },
      })
    }

    for (const upd of patch.updateNodes ?? []) {
      const id = createShapeId(upd.id) as TLShapeId
      if (!this.editor.getShape(id)) continue
      if (upd.label != null) {
        this.editor.updateShape({
          id,
          type: 'geo',
          props: { richText: toRichText(upd.label) },
        })
      }
    }

    // 最新ノードへカメラを寄せる
    if (newest) {
      this.editor.centerOnPoint({ x: newest.x + NODE_W / 2, y: newest.y + NODE_H / 2 }, {
        animation: { duration: 300 },
      })
    }
  }
}
