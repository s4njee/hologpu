import type { EffectField } from '@mk7s/hologpu';
import type { CompareStage } from './compare.ts';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function pixelsCanvas(read: { width: number; height: number; pixels: Uint8Array }) {
  const canvas = document.createElement('canvas');
  canvas.width = read.width;
  canvas.height = read.height;
  const straight = new Uint8ClampedArray(read.pixels);
  for (let i = 0; i < straight.length; i += 4) {
    const alpha = straight[i + 3]!;
    for (let c = 0; c < 3; c++)
      straight[i + c] = alpha ? Math.round((straight[i + c]! * 255) / alpha) : 0;
  }
  canvas.getContext('2d')!.putImageData(new ImageData(straight, read.width, read.height), 0, 0);
  return canvas;
}
type PixelRead = Awaited<ReturnType<EffectField['readPixels']>>;
type CaptureFrame = { left: PixelRead; right?: PixelRead; split: number };

async function captureFrame(
  field: EffectField,
  compare?: CompareStage,
  current: () => boolean = () => true,
): Promise<CaptureFrame | undefined> {
  while (current()) {
    // Snapshot the pair before awaiting input builds or GPU readbacks. A right
    // effect replaced during a read is discarded; the next pair uses its replacement.
    const right = compare?.field ?? undefined,
      split = compare?.split ?? 50,
      samePair = () => right === (compare?.field ?? undefined);
    try {
      await Promise.all([field.whenInputsReady(), right?.whenInputsReady()]);
      if (!current()) return;
      if (!samePair()) continue;
      field.render();
      right?.render();
      field.session.submit();
      if (right && right.session !== field.session) right.session.submit();
      const [leftPixels, rightPixels] = await Promise.all([
        field.readPixels(),
        right?.readPixels(),
      ]);
      if (!current()) return;
      if (!samePair()) continue;
      return { left: leftPixels, right: rightPixels, split };
    } catch (error) {
      if (!current()) return;
      if (!samePair()) continue;
      throw error;
    }
  }
}

function paintFrame(canvas: HTMLCanvasElement, frame: CaptureFrame) {
  const ctx = canvas.getContext('2d')!,
    left = pixelsCanvas(frame.left),
    right = frame.right ? pixelsCanvas(frame.right) : undefined;
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(left, 0, 0, canvas.width, canvas.height);
    if (right) {
      ctx.save();
      ctx.beginPath();
      ctx.rect((canvas.width * frame.split) / 100, 0, canvas.width, canvas.height);
      ctx.clip();
      // The right effect's transparent pixels must replace, not overlay, the left.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(right, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  } finally {
    left.width = left.height = 0;
    if (right) right.width = right.height = 0;
  }
}

export async function screenshot(field: EffectField, compare?: CompareStage) {
  const frame = (await captureFrame(field, compare))!,
    canvas = document.createElement('canvas');
  canvas.width = frame.left.width;
  canvas.height = frame.left.height;
  try {
    paintFrame(canvas, frame);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('PNG export failed'))),
        'image/png',
      ),
    );
    download(blob, `hologpu-${field.effect.id}.png`);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export class VideoCapture {
  recorder: MediaRecorder | null = null;
  #stream: MediaStream | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #raf = 0;
  #chunks: Blob[] = [];
  #generation = 0;
  #starting = false;
  #painting = false;
  readonly changed: (recording: boolean, message: string) => void;
  constructor(changed: (recording: boolean, message: string) => void) {
    this.changed = changed;
  }
  async start(field: EffectField, compare?: CompareStage) {
    if (this.recorder || this.#starting) throw new Error('A recording is already running');
    if (typeof MediaRecorder === 'undefined')
      throw new Error('Video recording is unavailable in this browser');
    const mimeType = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/mp4',
      'video/webm',
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('No supported video recording codec');
    const canvas = document.createElement('canvas');
    if (!canvas.captureStream) throw new Error('Video recording is unavailable in this browser');
    const generation = ++this.#generation;
    this.#starting = true;
    this.#canvas = canvas;
    const current = () =>
      this.#generation === generation &&
      this.#canvas === canvas &&
      (this.#starting || this.#painting);
    try {
      // Readback is intentionally confined to capture/export. This GPU-to-CPU SDR
      // copy and 2D upload costs time; it is never part of the GPU benchmark path.
      // Native WebGPU captureStream can emit blank frames on some browsers.
      const first = await captureFrame(field, compare, current);
      if (!first || !current()) return;
      canvas.width = first.left.width;
      canvas.height = first.left.height;
      paintFrame(canvas, first);
      // Seed actual pixels before MediaRecorder observes the stream.
      this.#stream = canvas.captureStream(60);
      this.#chunks = [];
      const recorder = new MediaRecorder(this.#stream, { mimeType });
      this.recorder = recorder;
      const ownsRecorder = () => this.#generation === generation && this.recorder === recorder;
      recorder.ondataavailable = (event) => {
        if (ownsRecorder() && event.data.size) this.#chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (!ownsRecorder()) return;
        this.#release();
        this.changed(false, 'Recording failed.');
      };
      recorder.onstop = () => {
        if (!ownsRecorder()) return;
        const blob = new Blob(this.#chunks, { type: mimeType });
        if (blob.size)
          download(blob, `hologpu-${field.effect.id}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
        this.#release();
        this.changed(false, blob.size ? 'Video saved.' : 'Recording contained no video frames.');
      };
      recorder.start(250);
      this.#starting = false;
      this.#painting = true;
      this.#requestFrame();
      this.changed(true, 'Recording canvas video…');
      if (!current()) return;
      const paint = async () => {
        this.#raf = 0;
        if (!current()) return;
        try {
          const frame = await captureFrame(field, compare, current);
          if (!frame || !current()) return;
          paintFrame(canvas, frame);
          this.#requestFrame();
          // Schedule only after this readback completes: at most one is in flight.
          this.#raf = requestAnimationFrame(() => void paint());
        } catch {
          if (!ownsRecorder()) return;
          this.#release();
          this.changed(false, 'Recording failed.');
        }
      };
      this.#raf = requestAnimationFrame(() => void paint());
    } catch (error) {
      if (this.#generation !== generation) return;
      this.#release();
      throw error;
    }
  }
  #requestFrame() {
    for (const track of this.#stream?.getVideoTracks() ?? [])
      (track as CanvasCaptureMediaStreamTrack).requestFrame?.();
  }
  stop() {
    if (this.#starting) {
      this.#release();
      this.changed(false, 'Recording cancelled.');
      return;
    }
    this.#painting = false;
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
  }
  #release() {
    ++this.#generation;
    this.#starting = false;
    this.#painting = false;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
    }
    this.#chunks = [];
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    if (this.#canvas) this.#canvas.width = this.#canvas.height = 0;
    this.#canvas = null;
  }
  dispose() {
    this.#release();
  }
}
