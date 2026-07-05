import type { GraphNode, NodeKind } from '../types'

/** ノードに添えるアイコン。emoji は文字、image は data URL。 */
export type IconResult = { type: 'emoji'; char: string } | { type: 'image'; dataUrl: string }

/** アイコン解決の差し替え可能インターフェース（PLAN.md §6 と同じ思想）。 */
export interface IconProvider {
  getIcon(node: GraphNode): Promise<IconResult | null>
}

const KIND_EMOJI: Record<NodeKind, string> = {
  topic: '💡',
  point: '📌',
  decision: '✅',
  question: '❓',
  action: '🏃',
}

// icon キーワード → emoji の簡易辞書（AI生成を使わない時の"映え"担保）
const KEYWORD_EMOJI: [RegExp, string][] = [
  [/budget|money|cost|price|予算|費用|コスト/i, '💰'],
  [/schedule|deadline|calendar|日程|期限|スケジュール/i, '📅'],
  [/user|customer|人|顧客|ユーザ/i, '👤'],
  [/team|meeting|会議|チーム/i, '👥'],
  [/idea|lightbulb|アイデア/i, '💡'],
  [/risk|warning|リスク|注意/i, '⚠️'],
  [/goal|target|目標|ゴール/i, '🎯'],
  [/growth|chart|graph|成長|グラフ|売上/i, '📈'],
  [/design|デザイン/i, '🎨'],
  [/code|dev|開発|実装/i, '💻'],
  [/launch|rocket|リリース|ローンチ/i, '🚀'],
  [/doc|document|資料|ドキュメント/i, '📄'],
  [/search|research|調査|検索/i, '🔍'],
  [/phone|mobile|スマホ|携帯/i, '📱'],
  [/mail|メール|連絡/i, '✉️'],
]

/** キー不要の emoji アイコン（icon キーワード → 辞書 → kind 既定の順で解決）。 */
export class EmojiIconProvider implements IconProvider {
  async getIcon(node: GraphNode): Promise<IconResult> {
    const target = `${node.icon ?? ''} ${node.label}`
    for (const [re, char] of KEYWORD_EMOJI) {
      if (re.test(target)) return { type: 'emoji', char }
    }
    return { type: 'emoji', char: KIND_EMOJI[node.kind] }
  }
}

/**
 * AI 画像生成アイコン（Worker の /api/icon 経由・PLAN.md Phase 2）。
 * - リアルタイム経路に載せない: 呼び出し側が非同期に await し、届いた時点で描き足す
 * - キャッシュ: サーバ側は Cache API、クライアント側はメモリ Map で再利用
 * - 失敗時は emoji にフォールバック
 */
export class GeneratedIconProvider implements IconProvider {
  private cache = new Map<string, Promise<IconResult | null>>()
  private fallback = new EmojiIconProvider()

  async getIcon(node: GraphNode): Promise<IconResult | null> {
    const keyword = (node.icon ?? '').trim().toLowerCase()
    if (!keyword) return this.fallback.getIcon(node)

    let pending = this.cache.get(keyword)
    if (!pending) {
      pending = this.fetchIcon(keyword).catch(() => null)
      this.cache.set(keyword, pending)
    }
    const result = await pending
    return result ?? this.fallback.getIcon(node)
  }

  private async fetchIcon(keyword: string): Promise<IconResult | null> {
    const res = await fetch(`/api/icon?q=${encodeURIComponent(keyword)}`, {
      credentials: 'include',
    })
    if (!res.ok) return null
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return { type: 'image', dataUrl }
  }
}
