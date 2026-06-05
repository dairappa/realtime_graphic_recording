import type { SttProvider, SttResult } from './types'
import type { Speaker } from '../types'

// Web Speech API は DOM 型に含まれないため最小限の宣言。
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: any) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/**
 * Web Speech API ベースの STT（無料・キー不要）。
 *
 * ⚠️ 制約: Web Speech API は MediaStream を受け取れず、OS の「デフォルト入力」しか
 * 書き起こせない。よって渡された stream は無視し、デフォルトマイクを書き起こす。
 * 相手の声まで拾うには、仮想オーディオデバイスを OS の既定入力に設定するか、
 * Deepgram（任意ストリーム対応）を使うこと。
 */
export class WebSpeechStt implements SttProvider {
  private rec: SpeechRecognitionLike | null = null
  private stopped = false

  async start(_stream: MediaStream, speaker: Speaker, onResult: (r: SttResult) => void) {
    const Ctor: SpeechRecognitionCtor | undefined =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) throw new Error('このブラウザは Web Speech API 非対応です（Chrome 推奨）')

    const rec = new Ctor()
    rec.lang = 'ja-JP'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        onResult({ text: r[0].transcript, isFinal: r.isFinal, speaker })
      }
    }
    rec.onend = () => {
      // continuous でも自動停止することがあるので、止めていなければ再開。
      if (!this.stopped) {
        try {
          rec.start()
        } catch {
          /* 連続再開の失敗は無視 */
        }
      }
    }
    rec.onerror = () => {
      /* no-op: onend 側で再開を試みる */
    }

    this.rec = rec
    this.stopped = false
    rec.start()
  }

  stop() {
    this.stopped = true
    this.rec?.stop()
    this.rec = null
  }
}
