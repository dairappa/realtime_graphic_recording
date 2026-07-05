import { useEffect, useRef, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'

import {
  captureDisplayAudio,
  captureMic,
  captureVirtualDevice,
  guessVirtualDevice,
  listInputDevices,
  type AudioInputDevice,
} from './audio/capture'
import { GraphRenderer } from './canvas/graphRenderer'
import { EmojiIconProvider, GeneratedIconProvider, type IconProvider } from './icons/provider'
import { Session, type SessionSnapshot, type Source } from './session'
import { DeepgramStt } from './stt/deepgram'
import { WebSpeechStt } from './stt/webSpeech'
import type { SttProvider } from './stt/types'
import { HeuristicStructurer } from './structure/heuristic'
import { LlmStructurer } from './structure/llm'
import type { Structurer } from './structure/types'
import type { Speaker } from './types'

type CaptureMode = 'browser' | 'desktop'
type SttKind = 'webspeech' | 'deepgram-proxy' | 'deepgram-direct'
type StructureMode = 'local' | 'proxy' | 'direct'
type IconMode = 'emoji' | 'ai' | 'none'

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function download(filename: string, blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

interface Line {
  speaker: Speaker
  text: string
  final: boolean
}

export function App() {
  const editorRef = useRef<Editor | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const sourcesRef = useRef<Source[]>([])
  const lastSnapshotRef = useRef<SessionSnapshot | null>(null)

  const [devices, setDevices] = useState<AudioInputDevice[]>([])
  const [micId, setMicId] = useState<string>('')
  const [virtualId, setVirtualId] = useState<string>('')
  const [mode, setMode] = useState<CaptureMode>('browser')
  const [sttKind, setSttKind] = useState<SttKind>('webspeech')
  const [deepgramKey, setDeepgramKey] = useState('')
  const [structureMode, setStructureMode] = useState<StructureMode>('local')
  const [llmKey, setLlmKey] = useState('')
  const [iconMode, setIconMode] = useState<IconMode>('emoji')

  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])

  useEffect(() => {
    listInputDevices()
      .then((d) => {
        setDevices(d)
        if (d[0]) setMicId(d[0].deviceId)
        const v = guessVirtualDevice(d)
        if (v) setVirtualId(v.deviceId)
      })
      .catch((e) => setError(String(e)))
  }, [])

  function pushLine(line: Line) {
    setLines((prev) => {
      // 同一話者の途中経過は最後の行を置き換える
      const next = [...prev]
      const last = next[next.length - 1]
      if (last && last.speaker === line.speaker && !last.final) next[next.length - 1] = line
      else next.push(line)
      return next.slice(-8)
    })
  }

  async function start() {
    setError(null)
    if (!editorRef.current) {
      setError('キャンバスがまだ準備できていません')
      return
    }
    try {
      const sources: Source[] = []
      // 自分の声（実マイク）
      sources.push({ stream: await captureMic(micId || undefined), speaker: 'me' })

      // 相手の声。Web Speech API は任意ストリームを扱えないため me のみ。
      const isDeepgram = sttKind !== 'webspeech'
      if (isDeepgram) {
        if (mode === 'browser') {
          sources.push({ stream: await captureDisplayAudio(), speaker: 'remote' })
        } else {
          if (!virtualId) throw new Error('仮想オーディオデバイスを選択してください（BlackHole / VB-Cable 等）')
          sources.push({ stream: await captureVirtualDevice(virtualId), speaker: 'remote' })
        }
      }

      const makeStt = (): SttProvider => {
        if (sttKind === 'deepgram-proxy') return new DeepgramStt({ mode: 'proxy' })
        if (sttKind === 'deepgram-direct') return new DeepgramStt({ mode: 'direct', apiKey: deepgramKey })
        return new WebSpeechStt()
      }

      let structurer: Structurer
      if (structureMode === 'proxy') structurer = new LlmStructurer({ endpoint: '/api/openai' })
      else if (structureMode === 'direct') structurer = new LlmStructurer({ apiKey: llmKey })
      else structurer = new HeuristicStructurer()

      let iconProvider: IconProvider | undefined
      if (iconMode === 'ai') iconProvider = new GeneratedIconProvider()
      else if (iconMode === 'emoji') iconProvider = new EmojiIconProvider()

      const renderer = new GraphRenderer(editorRef.current)
      const session = new Session({
        renderer,
        structurer,
        makeStt,
        iconProvider,
        flushIntervalMs: structureMode === 'local' ? 1500 : 8000,
        onTranscript: (r) => pushLine({ speaker: r.speaker, text: r.text, final: r.isFinal }),
        onError: (e) => setError(String(e)),
      })

      await session.start(sources)
      sessionRef.current = session
      sourcesRef.current = sources
      setRunning(true)
    } catch (e) {
      setError(String(e))
      sourcesRef.current.forEach((s) => s.stream.getTracks().forEach((t) => t.stop()))
      sourcesRef.current = []
    }
  }

  function stop() {
    if (sessionRef.current) lastSnapshotRef.current = sessionRef.current.getSnapshot()
    sessionRef.current?.stop(sourcesRef.current)
    sessionRef.current = null
    sourcesRef.current = []
    setRunning(false)
  }

  async function exportPng() {
    const editor = editorRef.current
    if (!editor) return
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) {
      setError('書き出す内容がありません')
      return
    }
    try {
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, scale: 2 })
      download(`grareco-${timestamp()}.png`, blob)
    } catch (e) {
      setError(String(e))
    }
  }

  function exportJson() {
    const snap = sessionRef.current?.getSnapshot() ?? lastSnapshotRef.current
    if (!snap) {
      setError('保存できるセッションがありません（収録後に使えます）')
      return
    }
    download(
      `grareco-${timestamp()}.json`,
      new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }),
    )
  }

  function clearCanvas() {
    const editor = editorRef.current
    if (!editor) return
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) return
    if (!confirm('キャンバスを全消去します。よろしいですか？')) return
    editor.deleteShapes(ids)
  }

  const remoteDisabled = sttKind === 'webspeech'

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>🎨 グラレコ Live</h1>
        <p className="muted">会議の音声をリアルタイムに構造化して描く（Phase 0 プロト）</p>

        <section>
          <label>STT エンジン</label>
          <select value={sttKind} onChange={(e) => setSttKind(e.target.value as SttKind)} disabled={running}>
            <option value="webspeech">Web Speech API（無料・マイクのみ）</option>
            <option value="deepgram-proxy">Deepgram（サーバ経由・デプロイ時）</option>
            <option value="deepgram-direct">Deepgram（ブラウザ直結・ローカル検証）</option>
          </select>
          {sttKind === 'deepgram-direct' && (
            <input
              type="password"
              placeholder="Deepgram API キー"
              value={deepgramKey}
              onChange={(e) => setDeepgramKey(e.target.value)}
              disabled={running}
            />
          )}
          {sttKind === 'deepgram-proxy' && (
            <p className="hint">/api/deepgram 経由（キーはサーバ秘匿）。Cloudflare で DEEPGRAM_API_KEY 設定が必要。</p>
          )}
        </section>

        <section>
          <label>マイク（自分の声）</label>
          <select value={micId} onChange={(e) => setMicId(e.target.value)} disabled={running}>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </section>

        <section className={remoteDisabled ? 'disabled' : ''}>
          <label>相手の声の取り方</label>
          <div className="radios">
            <label>
              <input
                type="radio"
                checked={mode === 'browser'}
                onChange={() => setMode('browser')}
                disabled={running || remoteDisabled}
              />
              ① ブラウザ会議（画面共有のタブ音声）
            </label>
            <label>
              <input
                type="radio"
                checked={mode === 'desktop'}
                onChange={() => setMode('desktop')}
                disabled={running || remoteDisabled}
              />
              ② デスクトップアプリ（仮想デバイス）
            </label>
          </div>
          {mode === 'desktop' && (
            <select
              value={virtualId}
              onChange={(e) => setVirtualId(e.target.value)}
              disabled={running || remoteDisabled}
            >
              <option value="">— 仮想オーディオデバイスを選択 —</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          {remoteDisabled && (
            <p className="hint">※ 相手の声の取込は Deepgram のみ対応（Web Speech は既定マイクのみ）</p>
          )}
        </section>

        <section>
          <label>構造化エンジン</label>
          <select
            value={structureMode}
            onChange={(e) => setStructureMode(e.target.value as StructureMode)}
            disabled={running}
          >
            <option value="local">ローカル簡易抽出（キー不要）</option>
            <option value="proxy">OpenAI（サーバ経由・デプロイ時）</option>
            <option value="direct">OpenAI（ブラウザ直結・ローカル検証）</option>
          </select>
          {structureMode === 'direct' && (
            <input
              type="password"
              placeholder="OpenAI API キー"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              disabled={running}
            />
          )}
          {structureMode === 'proxy' && (
            <p className="hint">/api/openai 経由（キーはサーバ秘匿）。Cloudflare で OPENAI_API_KEY 設定が必要。</p>
          )}
        </section>

        <section>
          <label>アイコン</label>
          <select value={iconMode} onChange={(e) => setIconMode(e.target.value as IconMode)} disabled={running}>
            <option value="emoji">絵文字（キー不要）</option>
            <option value="ai">AI生成（サーバ経由・デプロイ時）</option>
            <option value="none">なし</option>
          </select>
          {iconMode === 'ai' && (
            <p className="hint">
              /api/icon 経由で手描き風アイコンを非同期生成（OPENAI_API_KEY が必要）。
              同じキーワードはキャッシュされ再生成されない。
            </p>
          )}
        </section>

        {!running ? (
          <button className="primary" onClick={start}>
            ● 収録開始
          </button>
        ) : (
          <button className="stop" onClick={stop}>
            ■ 停止
          </button>
        )}

        <div className="toolbar">
          <button onClick={exportPng}>🖼 PNG書き出し</button>
          <button onClick={exportJson}>💾 JSON保存</button>
          <button onClick={clearCanvas} disabled={running}>
            🗑 クリア
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="transcript">
          {lines.map((l, i) => (
            <div key={i} className={`line ${l.speaker} ${l.final ? '' : 'interim'}`}>
              <b>{l.speaker === 'me' ? '自分' : '相手'}</b> {l.text}
            </div>
          ))}
        </div>
      </aside>

      <main className="canvas">
        <Tldraw
          persistenceKey="grareco-live"
          onMount={(editor) => {
            editorRef.current = editor
            // デバッグ用（コンソール/E2Eテストから編集APIを触れるように）
            ;(window as unknown as { editor: Editor }).editor = editor
          }}
        />
      </main>
    </div>
  )
}
