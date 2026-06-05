import type { Speaker } from '../types'

export interface SttResult {
  text: string
  isFinal: boolean
  speaker: Speaker
}

/** STT プロバイダの差し替え可能インターフェース（PLAN.md §6）。 */
export interface SttProvider {
  /** 指定ストリームの書き起こしを開始。speaker はチャンネル＝話者ラベル。 */
  start(stream: MediaStream, speaker: Speaker, onResult: (r: SttResult) => void): Promise<void>
  stop(): void
}
