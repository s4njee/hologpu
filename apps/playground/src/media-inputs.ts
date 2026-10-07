import { createEffect, type EffectField, type InputSource } from '@mk7s/hologpu';
import { catalogue } from '@mk7s/hologpu/effects';
const mediaBase = `${import.meta.env.BASE_URL}media/`;
type OwnedInput = {
  source: InputSource | EffectField | null;
  release: () => void;
  preview?: HTMLElement;
  label: string;
};
/** Explicit media controls own the resources they create; core inputs only borrow caller media. */
export function mediaInputs(field: EffectField, panel: HTMLElement): () => void {
  panel.replaceChildren();
  const imageCapable = field.effect.inputs.includes('image');
  const textCapable = field.effect.inputs.includes('text');
  const audioCapable = field.effect.inputs.includes('audio');
  const secondImageCapable = field.effect.inputs.includes('imageB');
  panel.hidden = !imageCapable && !textCapable && !audioCapable;
  if (panel.hidden) return () => {};
  type Binding = 'image' | 'imageB' | 'text' | 'audio';
  let visualBinding: Binding = imageCapable ? 'image' : 'text';
  let alive = true;
  const revisions: Record<Binding, number> = { image: 0, imageB: 0, text: 0, audio: 0 };
  const ownedInputs = new Map<Binding, OwnedInput>();
  const releases = new Set<() => void>();
  const own = (dispose: () => void) => {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      releases.delete(release);
      dispose();
    };
    releases.add(release);
    return release;
  };
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, id?: string) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    return node;
  };
  const label = (title: string, node: HTMLElement) => {
    const l = make('label');
    l.append(title, node);
    return l;
  };
  const button = (id: string, title: string) => {
    const b = make('button', id);
    b.type = 'button';
    b.textContent = title;
    return b;
  };
  const picker = make('select', 'media-source');
  for (const [value, title] of [
    ['none', 'Effect fallback'],
    ['image', 'Sample image'],
    ['video', 'Sample video · 1080p60'],
    ['camera', 'Webcam'],
    ['canvas', 'Animated canvas'],
    ['text', 'Text mask'],
    ['effect', 'Another effect'],
  ]) {
    const option = make('option');
    option.value = value!;
    option.textContent = title!;
    if (imageCapable || value === 'none' || value === 'text') picker.append(option);
  }
  const imageFile = make('input', 'media-image-file');
  imageFile.type = 'file';
  imageFile.accept = 'image/*';
  const videoFile = make('input', 'media-video-file');
  videoFile.type = 'file';
  videoFile.accept = 'video/*';
  const text = make('input', 'media-text');
  text.type = 'text';
  text.value = 'GPU';
  text.maxLength = 80;
  const textApply = button('media-text-apply', 'Use text mask');
  const camera = button('media-camera-start', 'Start webcam');
  const secondImageFile = make('input', 'media-imageB-file');
  secondImageFile.type = 'file';
  secondImageFile.accept = 'image/*';
  const secondImageSample = button('media-imageB-sample', 'Use sample second image');
  const secondImageClear = button('media-imageB-clear', 'Clear second image');
  const secondImageStatus = make('p', 'media-imageB-status');
  secondImageStatus.className = 'muted';
  secondImageStatus.setAttribute('role', 'status');
  const sampleAudio = button('media-audio-sample', 'Use sample audio');
  const audioFile = make('input', 'media-audio-file');
  audioFile.type = 'file';
  audioFile.accept = 'audio/*';
  const mic = button('media-microphone-start', 'Start microphone');
  const stopAudio = button('media-audio-stop', 'Stop audio');
  const preview = make('div', 'media-preview');
  const status = make('p', 'media-status');
  status.className = 'muted';
  status.setAttribute('role', 'status');
  const audioStatus = make('p', 'media-audio-status');
  audioStatus.className = 'muted';
  audioStatus.setAttribute('role', 'status');
  if (imageCapable || textCapable) {
    panel.append(label(imageCapable ? 'Image source' : 'Text source', picker));
    if (imageCapable)
      panel.append(label('Upload image', imageFile), label('Upload video', videoFile), camera);
    panel.append(label('Text mask', text), textApply, preview, status);
  }
  if (secondImageCapable)
    panel.append(
      label('Upload second image', secondImageFile),
      secondImageSample,
      secondImageClear,
      secondImageStatus,
    );
  // Image-filter controls retain their optional audio sampler for the M4 input laboratory.
  if (audioCapable || imageCapable)
    panel.append(label('Upload audio', audioFile), sampleAudio, mic, stopAudio, audioStatus);
  const report = (target: HTMLElement, error: unknown) => {
    if (alive)
      target.textContent = `Input unavailable: ${error instanceof Error ? error.message : String(error)}. Choose a sample or the effect fallback.`;
  };
  const targetStatus = (name: Binding) =>
    name === 'audio' ? audioStatus : name === 'imageB' ? secondImageStatus : status;
  const apply = async (name: Binding, factory: () => Promise<OwnedInput>) => {
    const revision = ++revisions[name];
    let candidate: OwnedInput | undefined;
    try {
      candidate = await factory();
      if (!alive || revision !== revisions[name]) {
        candidate.release();
        return;
      }
      await field.bindInput(name, candidate.source);
      if (!alive || revision !== revisions[name]) {
        candidate.release();
        return;
      }
      ownedInputs.get(name)?.release();
      ownedInputs.set(name, candidate);
      if (name === 'image' || name === 'text')
        preview.replaceChildren(...(candidate.preview ? [candidate.preview] : []));
      targetStatus(name).textContent = candidate.label;
    } catch (error) {
      candidate?.release();
      if (alive && revision === revisions[name]) report(targetStatus(name), error);
    }
  };
  const none = async (): Promise<OwnedInput> => ({
    source: null,
    release() {},
    label: 'Using the effect fallback.',
  });
  const sampleImage = async (file?: File): Promise<OwnedInput> => {
    const image = new Image(),
      url = file ? URL.createObjectURL(file) : undefined;
    let bitmap: ImageBitmap | undefined,
      disposed = false,
      urlReleased = false;
    const releaseURL = () => {
      if (url && !urlReleased) {
        urlReleased = true;
        URL.revokeObjectURL(url);
      }
    };
    // Register before decoding: an unmounted picker must release an unfinished upload too.
    const release = own(() => {
      disposed = true;
      image.removeAttribute('src');
      releaseURL();
      bitmap?.close();
    });
    try {
      image.src = url ?? `${mediaBase}sample.svg`;
      await image.decode();
      if (disposed) throw new Error('Input picker was closed');
      const decoded = await createImageBitmap(image);
      if (disposed) {
        decoded.close();
        throw new Error('Input picker was closed');
      }
      bitmap = decoded;
      return {
        source: { kind: 'image', source: bitmap },
        release,
        label: `Image · ${bitmap.width} × ${bitmap.height}`,
      };
    } catch (error) {
      release();
      throw error;
    } finally {
      releaseURL();
    }
  };
  const videoInput = async (file?: File, stream?: MediaStream): Promise<OwnedInput> => {
    const video = make('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = !stream;
    video.controls = !stream;
    video.width = 240;
    video.height = 135;
    const url = file ? URL.createObjectURL(file) : undefined;
    let disposed = false;
    const release = own(() => {
      if (disposed) return;
      disposed = true;
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
      video.remove();
      if (url) URL.revokeObjectURL(url);
      stream?.getTracks().forEach((track) => track.stop());
    });
    try {
      // Attaching the decoder before playback gives browser external textures a visible backing frame.
      preview.append(video);
      const loaded = new Promise<void>((resolve, reject) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.addEventListener('error', () => reject(new Error('Video could not be decoded')), {
          once: true,
        });
      });
      if (stream) video.srcObject = stream;
      else
        video.src =
          url ??
          (video.canPlayType('video/mp4; codecs="avc1.42E01E"')
            ? `${mediaBase}sample-1080p60.mp4`
            : `${mediaBase}sample-1080p60.webm`);
      await loaded;
      await video.play();
      if (video.requestVideoFrameCallback)
        await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
      return {
        source: { kind: 'video', source: video },
        preview: video,
        release,
        label: `${stream ? 'Webcam' : 'Video'} · ${video.videoWidth} × ${video.videoHeight}`,
      };
    } catch (error) {
      release();
      throw error;
    }
  };
  const cameraInput = async () => {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera capture is unavailable in this browser');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    if (!alive) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('Input picker was closed');
    }
    return videoInput(undefined, stream);
  };
  const canvasInput = async (): Promise<OwnedInput> => {
    const canvas = make('canvas');
    canvas.width = 480;
    canvas.height = 270;
    canvas.style.width = '240px';
    canvas.style.height = '135px';
    const ctx = canvas.getContext('2d')!;
    let raf = 0,
      active = true;
    const draw = (time: number) => {
      if (!active) return;
      const t = field.reducedMotion ? 0 : time / 1000;
      ctx.fillStyle = '#132c45';
      ctx.fillRect(0, 0, 480, 270);
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = `hsl(${(i * 31 + t * 12) % 360} 70% 65%)`;
        ctx.beginPath();
        ctx.arc(
          240 + Math.sin(t * 0.7 + i) * 180,
          135 + Math.cos(t * 0.9 + i * 1.7) * 90,
          8 + i * 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      field.invalidate();
      raf = requestAnimationFrame(draw);
    };
    draw(0);
    return {
      source: { kind: 'canvas', source: canvas },
      preview: canvas,
      release: own(() => {
        active = false;
        cancelAnimationFrame(raf);
      }),
      label: 'Animated canvas · 480 × 270',
    };
  };
  const textInput = async (): Promise<OwnedInput> => ({
    source: {
      kind: 'text',
      text: text.value,
      width: 960,
      height: 540,
      font: 'bold 200px sans-serif',
    },
    release() {},
    label: `Text mask · ${text.value || '(empty)'}`,
  });
  const effectInput = async (): Promise<OwnedInput> => {
    const canvas = make('canvas');
    canvas.style.width = '240px';
    canvas.style.height = '135px';
    preview.append(canvas);
    let source: EffectField | undefined;
    try {
      source = await createEffect(
        canvas,
        catalogue.find((e) => e.id === 'gradient-oklch')!,
        { seed: 7, playing: true, resolutionScale: 1 },
      );
      source.drawAt(0, 7);
      return {
        source,
        preview: canvas,
        release() {
          source?.destroy();
          canvas.remove();
        },
        label: 'Another effect · OKLCH mesh gradient',
      };
    } catch (error) {
      source?.destroy();
      canvas.remove();
      throw error;
    }
  };
  const audioInput = async (file?: File, microphone = false): Promise<OwnedInput> => {
    if (typeof AudioContext === 'undefined') throw new Error('Web Audio is unavailable');
    const revision = revisions.audio;
    const context = new AudioContext(),
      analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    let stream: MediaStream | undefined,
      node: AudioNode | undefined,
      disposed = false;
    const release = own(() => {
      if (disposed) return;
      disposed = true;
      if (node instanceof AudioBufferSourceNode)
        try {
          node.stop();
        } catch {}
      node?.disconnect();
      analyser.disconnect();
      stream?.getTracks().forEach((t) => t.stop());
      void context.close();
    });
    try {
      await context.resume();
      if (!alive || disposed || revision !== revisions.audio)
        throw new Error('Input picker was closed');
      if (microphone) {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('Microphone capture is unavailable in this browser');
        const captured = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!alive || disposed || revision !== revisions.audio) {
          captured.getTracks().forEach((track) => track.stop());
          throw new Error('Input picker was closed');
        }
        stream = captured;
        node = context.createMediaStreamSource(stream);
        node.connect(analyser);
      } else {
        const data = file
          ? await file.arrayBuffer()
          : await (await fetch(`${mediaBase}sample.wav`)).arrayBuffer();
        if (!alive || disposed || revision !== revisions.audio)
          throw new Error('Input picker was closed');
        const buffer = await context.decodeAudioData(data);
        if (!alive || disposed || revision !== revisions.audio)
          throw new Error('Input picker was closed');
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(analyser);
        analyser.connect(context.destination);
        source.start();
        node = source;
      }
      return {
        source: { kind: 'audio', analyser },
        release,
        label: `${microphone ? 'Microphone' : 'Audio file'} · ${context.sampleRate} Hz · ${analyser.frequencyBinCount} FFT bins`,
      };
    } catch (error) {
      release();
      throw error;
    }
  };
  picker.onchange = () => {
    const factories: Record<string, () => Promise<OwnedInput>> = {
      none,
      image: () => sampleImage(),
      video: () => videoInput(),
      canvas: canvasInput,
      text: textInput,
      effect: effectInput,
    };
    if (picker.value === 'camera') {
      status.textContent = 'Click Start webcam to allow camera access.';
      return;
    }
    if (picker.value !== 'none')
      visualBinding =
        picker.value === 'text' && textCapable ? 'text' : imageCapable ? 'image' : 'text';
    void apply(visualBinding, factories[picker.value] ?? none);
  };
  imageFile.onchange = () => {
    const file = imageFile.files?.[0];
    if (file) {
      picker.value = 'image';
      visualBinding = 'image';
      void apply('image', () => sampleImage(file));
    }
  };
  videoFile.onchange = () => {
    const file = videoFile.files?.[0];
    if (file) {
      picker.value = 'video';
      visualBinding = 'image';
      void apply('image', () => videoInput(file));
    }
  };
  camera.onclick = () => {
    picker.value = 'camera';
    visualBinding = 'image';
    void apply('image', cameraInput);
  };
  textApply.onclick = () => {
    picker.value = 'text';
    visualBinding = textCapable ? 'text' : 'image';
    void apply(visualBinding, textInput);
  };
  secondImageSample.onclick = () => void apply('imageB', () => sampleImage());
  secondImageClear.onclick = () => void apply('imageB', none);
  secondImageFile.onchange = () => {
    const file = secondImageFile.files?.[0];
    if (file) void apply('imageB', () => sampleImage(file));
  };
  sampleAudio.onclick = () => void apply('audio', () => audioInput());
  audioFile.onchange = () => {
    const file = audioFile.files?.[0];
    if (file) void apply('audio', () => audioInput(file));
  };
  mic.onclick = () => void apply('audio', () => audioInput(undefined, true));
  stopAudio.onclick = () => void apply('audio', none);
  status.textContent = imageCapable
    ? 'Using the effect fallback. Camera and microphone start only from their buttons.'
    : 'Using the effect text fallback.';
  secondImageStatus.textContent = 'Using the second-image effect fallback.';
  return () => {
    if (!alive) return;
    alive = false;
    for (const name of Object.keys(revisions) as Binding[]) revisions[name]++;
    for (const input of ownedInputs.values()) input.release();
    ownedInputs.clear();
    for (const release of [...releases]) release();
    panel.replaceChildren();
  };
}
