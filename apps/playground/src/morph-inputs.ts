import type { EffectField } from '@mk7s/hologpu';
/** M3 local raster targets; the general texture/video input layer remains M4. */
export function morphInputs(field: EffectField, panel: HTMLElement) {
  panel.replaceChildren();
  panel.hidden = field.effect.id !== 'morph-particles';
  if (panel.hidden) return;
  const text = document.createElement('input');
  text.id = 'morph-text';
  text.type = 'text';
  text.value = 'GPU';
  text.maxLength = 80;
  const label = document.createElement('label');
  label.textContent = 'Custom text target';
  label.append(text);
  const apply = document.createElement('button');
  apply.id = 'morph-text-apply';
  apply.textContent = 'Use text';
  const image = document.createElement('input');
  image.id = 'morph-image';
  image.type = 'file';
  image.accept = 'image/*';
  const imageLabel = document.createElement('label');
  imageLabel.textContent = 'Image target';
  imageLabel.append(image);
  const status = document.createElement('p');
  status.className = 'muted';
  status.id = 'morph-input-status';
  status.setAttribute('role', 'status');
  panel.append(label, apply, imageLabel, status);
  apply.onclick = async () => {
    try {
      field.store.set('mask', 'text');
      await field.setInput('text', text.value);
      field.reset();
      status.textContent = 'Text target updated.';
    } catch (error) {
      status.textContent = String(error);
    }
  };
  image.onchange = async () => {
    const file = image.files?.[0];
    if (!file) return;
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file);
      if (field.state !== 'ready') return;
      field.store.set('mask', 'image');
      await field.setInput('image', bitmap);
      field.reset();
      status.textContent = `Image target updated: ${bitmap.width} × ${bitmap.height}.`;
    } catch (error) {
      status.textContent = String(error);
    } finally {
      bitmap?.close();
    }
  };
}
