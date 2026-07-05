import type { SttProvider, SttResult } from './types'
import type { Speaker } from '../types'

export type DeepgramSttOptions =
  | { mode: 'proxy' }
  | { mode: 'direct'; apiKey: string }

/**
 * Deepgram ストリーミング STT（任意 MediaStream 対応・本番経路）。
 *
 * 2 モード:
 *  - proxy:  Cloudflare Worker の /api/deepgram を中継（キーはサーバ秘匿）← 本番推奨
 *            WS ハンドシェイク前に /api/deepgram/ticket で短命チケットを取得する。
 *  - direct: Deepgram へブラウザ直結（ローカル検証用。キーが露出する点に注意）。
 *            ブラウザの WebSocket は Authorization ヘッダを付けられないため、
 *            subprotocol 方式（['token', apiKey]）でキーを渡す。
 */
export class DeepgramStt implements SttProvider {
  private ws: WebSocket | null = null
  private recorder: MediaRecorder | null = null
  private stopped = false

  constructor(private opts: DeepgramSttOptions) {}

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

    let ws: WebSocket
    if (this.opts.mode === 'proxy') {
      const res = await fetch('/api/deepgram/ticket', { method: 'POST', credentials: 'include' })
      if (!res.ok) throw new Error(`Deepgram チケット取得に失敗: ${res.status} ${await res.text()}`)
      const { ticket } = await res.json()
      params.set('ticket', ticket)
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${scheme}://${location.host}/api/deepgram?${params.toString()}`)
    } else {
      ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
        'token',
        this.opts.apiKey,
      ])
    }
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
    ws.onclose = (e) => {
      if (!this.stopped && e.code !== 1000) {
        console.warn(`Deepgram WebSocket が閉じました: code=${e.code} reason=${e.reason}`)
      }
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
