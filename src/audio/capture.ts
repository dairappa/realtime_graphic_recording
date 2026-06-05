// ---- キャプチャ層（PLAN.md §3）----
// マイクと相手の声を「混ぜず 2 ストリーム」で取得する。

export interface AudioInputDevice {
  deviceId: string
  label: string
}

/** 入力デバイス一覧（仮想オーディオデバイスの検出に使う）。
 *  ラベルを得るには一度マイク許可が必要なため、先に getUserMedia を試みる。 */
export async function listInputDevices(): Promise<AudioInputDevice[]> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
    probe.getTracks().forEach((t) => t.stop())
  } catch {
    // 許可されなければラベル無しで返す
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || '(名称不明の入力)' }))
}

/** 仮想オーディオデバイスらしき入力を推定（BlackHole / VB-Cable など）。 */
export function guessVirtualDevice(devices: AudioInputDevice[]): AudioInputDevice | undefined {
  const re = /blackhole|cable|vb-?audio|voicemeeter|loopback|soundflower/i
  return devices.find((d) => re.test(d.label))
}

/** 自分の声（実マイク）。音声処理は ON のまま。 */
export function captureMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
}

/** モード①: ブラウザ会議タブの音声を画面共有経由で取得。 */
export async function captureDisplayAudio(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true, // 多くのブラウザは audio 単独の共有を許さないため video も要求
    audio: true,
  })
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('共有された画面に音声が含まれていません（「タブの音声を共有」を有効に）')
  }
  return stream
}

/** モード②: 仮想オーディオデバイス（Zoom 等のデスクトップアプリ音声）。
 *  会議の複数人音声に音声処理を掛けると劣化するため 3 つとも OFF。 */
export function captureVirtualDevice(deviceId: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  })
}
