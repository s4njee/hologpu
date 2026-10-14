import type { EffectField, ParamSchema } from '@mk7s/hologpu-core';

interface TextRun {
  text: string;
  x: number;
  y: number;
  font: string;
  direction: CanvasDirection;
  letterSpacing: string;
  wordSpacing: string;
}

/** Capture laid-out text lines, retaining shaping within each line and styled text node. */
export function rasterTextMask(host: HTMLElement, target: HTMLElement, dpr: number) {
  const bounds = target.getBoundingClientRect();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bounds.width * dpr));
  canvas.height = Math.max(1, Math.ceil(bounds.height * dpr));
  const painter = canvas.getContext('2d')!;
  const runs: TextRun[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,[aria-hidden="true"]')) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility !== 'visible') continue;
    const font =
      style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    painter.font = font;
    const metrics = painter.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent || Number.parseFloat(style.fontSize) * 0.8;
    const range = document.createRange();
    let pending: { start: number; end: number; top: number; text: string } | undefined;
    const flush = () => {
      if (!pending) return;
      range.setStart(node, pending.start);
      range.setEnd(node, pending.end);
      const rect = range.getBoundingClientRect();
      let text = pending.text;
      if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase();
      else if (style.textTransform === 'lowercase') text = text.toLocaleLowerCase();
      else if (style.textTransform === 'capitalize')
        text = text.replace(/\b\p{L}/gu, (value) => value.toLocaleUpperCase());
      runs.push({
        text,
        x: rect.left - bounds.left,
        y: rect.top - bounds.top + ascent,
        font,
        direction: style.direction === 'rtl' ? 'rtl' : 'ltr',
        letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing,
        wordSpacing: style.wordSpacing === 'normal' ? '0px' : style.wordSpacing,
      });
      pending = undefined;
    };
    for (const part of segmenter.segment(node.textContent ?? '')) {
      range.setStart(node, part.index);
      range.setEnd(node, part.index + part.segment.length);
      const rect = [...range.getClientRects()].find((r) => r.width > 0 && r.height > 0);
      if (!rect) continue; // Collapsed whitespace has no painted advance.
      if (pending && Math.abs(pending.top - rect.top) > 1) flush();
      pending ??= { start: part.index, end: part.index, top: rect.top, text: '' };
      pending.end = part.index + part.segment.length;
      pending.text += part.segment;
    }
    flush();
  }
  painter.scale(dpr, dpr);
  painter.fillStyle = 'white';
  painter.textAlign = 'left';
  painter.textBaseline = 'alphabetic';
  for (const run of runs) {
    painter.font = run.font;
    painter.direction = run.direction;
    Reflect.set(painter, 'letterSpacing', run.letterSpacing);
    Reflect.set(painter, 'wordSpacing', run.wordSpacing);
    painter.fillText(run.text, run.x, run.y);
  }
  return { canvas, runs, signature: JSON.stringify([canvas.width, canvas.height, dpr, runs]) };
}

/** Bind immutable snapshots only when layout, content or fonts change; steady frames never upload. */
export async function bindDOMTextMask<S extends ParamSchema>(
  host: HTMLElement,
  field: EffectField<S>,
) {
  let alive = true,
    queued = 0,
    revision = 0,
    signature = '',
    dpr = field.surface!.dpr;
  let fontContentRevision = 0;
  let fontReady = document.fonts.status === 'loaded' ? document.fonts.ready : undefined;
  let morphText: string | undefined;
  const update = async () => {
    if (!alive || field.state !== 'ready') return;
    dpr = field.surface!.dpr;
    const snapshot = rasterTextMask(host, field.canvas, dpr);
    const contentSignature = `${fontContentRevision}:${snapshot.signature}`;
    const request = ++revision;
    // Returning to the bound layout must also invalidate an older pending bitmap.
    if (contentSignature === signature) return;
    const bitmap = await createImageBitmap(snapshot.canvas);
    try {
      if (!alive || request !== revision || field.state !== 'ready') return;
      await field.bindInput('text', { kind: 'image', source: bitmap });
      if (field.effect.id === 'morph-particles' && morphText !== host.textContent) {
        await field.setInput('text', host.textContent ?? '');
        morphText = host.textContent ?? '';
      }
      if (alive && request === revision) signature = contentSignature;
    } finally {
      bitmap.close();
    }
  };
  const report = (error: unknown) => {
    if (alive && field.state === 'ready')
      host.dispatchEvent(
        new CustomEvent('hgpu-error', {
          detail: { field, error },
          bubbles: true,
          composed: true,
        }),
      );
  };
  const refresh = () => {
    if (!alive || queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      void update().catch(report);
    });
  };
  // Some WebKit builds omit loadingdone for JS FontFaces. The ready promise also
  // identifies a font-loading cycle, including outline changes with equal metrics.
  const waitForFonts = () => {
    const pending = document.fonts.ready;
    if (pending === fontReady) return;
    fontReady = pending;
    void pending.then(() => {
      if (!alive) return;
      fontContentRevision++;
      refresh();
    });
  };
  const mutations = new MutationObserver(refresh);
  mutations.observe(host, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'dir', 'lang'],
  });
  const ancestors = new MutationObserver(refresh);
  for (let node = host.parentElement; node; node = node.parentElement)
    ancestors.observe(node, {
      attributes: true,
      attributeFilter: ['style', 'class', 'dir', 'lang'],
    });
  const size = new ResizeObserver(refresh);
  size.observe(host);
  const before = field.onBeforeFrame(() => {
    if (dpr !== field.surface?.dpr) refresh();
  });
  const state = field.onChange(() => {
    if (field.state === 'ready') refresh();
  });
  window.addEventListener('resize', refresh);
  document.fonts.addEventListener('loading', waitForFonts);
  document.fonts.addEventListener('loadingdone', waitForFonts);
  waitForFonts();
  void document.fonts.ready.then(refresh);
  const dispose = () => {
    alive = false;
    revision++;
    cancelAnimationFrame(queued);
    mutations.disconnect();
    ancestors.disconnect();
    size.disconnect();
    before();
    state();
    window.removeEventListener('resize', refresh);
    document.fonts.removeEventListener('loading', waitForFonts);
    document.fonts.removeEventListener('loadingdone', waitForFonts);
  };
  try {
    await update();
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}
