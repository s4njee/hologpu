import { elementCaptureMethod, type EffectField } from '@mk7s/hologpu';
/** The experiment owns a fixture. Author DOM is never reparented into a canvas. */
export function backdropInputs(field: EffectField, root: HTMLElement) {
  if (field.effect.id !== 'backdrop-glass') return () => {};
  root.hidden = false;
  const host = document.createElement('section'),
    status = document.createElement('p'),
    button = document.createElement('button');
  host.id = 'backdrop-experiment';
  button.type = 'button';
  button.textContent = 'Enable DOM capture';
  const method = elementCaptureMethod(field.session.device.queue);
  status.textContent = method
    ? 'Texture preview · DOM capture is available for this browser experiment.'
    : 'Texture preview · HTML-in-canvas capture is unavailable in this browser.';
  button.disabled = !method;
  host.append(status, button);
  root.append(host);
  let source: HTMLCanvasElement | undefined,
    disposed = false,
    enabled = false;
  const invalidate = () => field.invalidate();
  const captured = () => {
    if (disposed) return;
    status.textContent = field.textureTaps.domCapture
      ? 'Live DOM capture · edit the source text to repaint the glass.'
      : 'Capture pending or unavailable · texture preview remains active.';
    invalidate();
  };
  button.onclick = async () => {
    if (disposed || enabled) return;
    source = document.createElement('canvas');
    source.id = 'backdrop-source';
    source.width = 320;
    source.height = 160;
    source.style.cssText = 'width:320px;max-width:100%;height:160px';
    source.setAttribute(
      'content' in HTMLCanvasElement.prototype ? 'content' : 'layoutsubtree',
      'content' in HTMLCanvasElement.prototype ? 'drawable' : '',
    );
    const content = document.createElement('div');
    content.id = 'backdrop-content';
    content.style.cssText =
      'width:320px;height:160px;box-sizing:border-box;padding:24px;color:white;background:linear-gradient(90deg,#d14725 0 50%,#2557d1 50%);font:20px sans-serif';
    const title = document.createElement('strong'),
      input = document.createElement('input');
    title.textContent = 'Real DOM backdrop';
    input.value = 'Edit this text';
    input.setAttribute('aria-label', 'Backdrop sample text');
    input.style.cssText = 'display:block;width:240px;margin-top:12px;color:#111;background:white';
    content.append(title, input);
    source.append(content);
    const context = source.getContext('2d') as
      | (CanvasRenderingContext2D & {
          drawElementImage?: (element: HTMLElement, x: number, y: number) => DOMMatrix | void;
        })
      | null;
    source.addEventListener('paint', () => {
      context?.clearRect(0, 0, 320, 160);
      const transform = context?.drawElementImage?.(content, 0, 0);
      if (transform) content.style.transform = transform.toString();
      invalidate();
    });
    try {
      await field.setInput('element', content);
      if (disposed) {
        source.remove();
        return;
      }
      host.append(source);
      source.addEventListener('paint', captured);
      enabled = true;
      button.disabled = true;
      status.textContent = 'Live DOM capture · edit the source text to repaint the glass.';
    } catch (error) {
      source.remove();
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  return () => {
    disposed = true;
    source?.removeEventListener('paint', captured);
    source?.remove();
    host.remove();
  };
}
