import type { SttProvider, SttResult } from './types'
import type { Speaker } from '../types'

/**
 * Deepgram ストリーミング STT（任意 MediaStream 対応・本番経路）。
 *
 * ブラウザの WebSocket は Authorization ヘッダを付けられないため、Deepgram が
 * サポートする subprotocol 方式（['token', apiKey]）でキーを渡す。
 *
 * ⚠️ 本番ではキーをクライアントに置かず Cloudflare Worker でプロキシすること。
 * ここはローカル検証用の直結実装。
 */
export class DeepgramStt implements SttProvider {
  private ws: WebSocket | null = null
  private recorder: MediaRecorder | null = null
  private stopped = false

  constructor(private apiKey: string) {}

  async start(stream: MediaStream, speaker: Speaker, onResult: (r: SttResult) => void) {
    this.stopped = false
    const params = new URLSearchParams({
      model: 'nova-2',
      language: 'ja',
      interim_results: 'true',
      smart_format: 'true',
      // 相手チャンネル側は複数人の可能性があるので話者分離を有効化
      diarize: speaker === 'remote' ? 'true' : 'false',
    })
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`
    const ws = new WebSocket(url, ['token', this.apiKey])
    this.ws = ws

    ws.onopen = () => {
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
      }
      recorder.start(250) // 250ms ごとに送出
      this.recorder = recorder
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        const alt = msg.channel?.alternatives?.[0]
        const text: string | undefined = alt?.transcript
        if (text) onResult({ text, isFinal: !!msg.is_final, speaker })
      } catch {
        /* keep-alive 等はスキップ */
      }
    }

    ws.onerror = () => {
      if (!this.stopped) console.warn('Deepgram WebSocket エラー')
    }
  }

  stop() {
    this.stopped = true
    this.recorder?.stop()
    this.recorder = null
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }))
    }
    this.ws?.close()
    this.ws = null
  }
}
