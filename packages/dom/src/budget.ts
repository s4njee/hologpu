import type { EffectBudget, EffectDefinition, EffectField } from '@mk7s/hologpu-core';

export interface PageBudgetOptions {
  /** Expected recurring render work in milliseconds per frame; default 4. */
  milliseconds?: number;
  /** Enabled automatically in Vite development. Other environments may opt in. */
  enabled?: boolean;
}
interface BudgetAttachment {
  host: HTMLElement;
  effect: EffectDefinition;
  field:
    | (Pick<
        EffectField,
        'canvas' | 'playing' | 'visible' | 'reducedMotion' | 'state' | 'surface'
      > & {
        onChange(listener: () => void): () => void;
        onRendered(listener: () => void): () => void;
      })
    | null;
  state: string;
}
export interface PageBudgetSnapshot {
  milliseconds: number;
  expectedMs: number;
  fields: readonly { id: string; expectedMs: number; size: readonly [number, number] }[];
  undeclared: readonly string[];
}
const attachments = new Map<BudgetAttachment, (() => void) | null>();
let removePageListeners: (() => void) | undefined;
let milliseconds = 4;
let enabled = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
let timer: ReturnType<typeof setTimeout> | undefined;
let warned = false;
/** Linear pixel-area estimate. Parameters, passes and hardware can change actual cost. */
export function estimateEffectBudget(budget: EffectBudget, size: readonly [number, number]) {
  return (
    (budget.expectedMs * size[0] * size[1]) / (budget.referenceSize[0] * budget.referenceSize[1])
  );
}
export function configurePageBudget(options: PageBudgetOptions = {}) {
  if (options.milliseconds !== undefined) {
    if (!Number.isFinite(options.milliseconds) || options.milliseconds <= 0)
      throw new RangeError('Page budget must be positive finite milliseconds');
    milliseconds = options.milliseconds;
  }
  if (options.enabled !== undefined) enabled = options.enabled;
  warned = false;
  syncMonitors();
  scheduleCheck();
}
export function pageBudgetSnapshot(): PageBudgetSnapshot {
  const fields: PageBudgetSnapshot['fields'][number][] = [];
  const undeclared: string[] = [];
  for (const attachment of attachments.keys()) {
    const { field, host, effect } = attachment;
    if (
      attachment.state !== 'ready' ||
      !field?.playing ||
      !field.visible ||
      field.reducedMotion ||
      field.state !== 'ready' ||
      document.hidden
    )
      continue;
    const rect = host.getBoundingClientRect();
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.right <= 0 ||
      rect.top >= innerHeight ||
      rect.left >= innerWidth
    )
      continue;
    if (!effect.budget) {
      undeclared.push(effect.id);
      continue;
    }
    const size = field.surface?.size ?? [field.canvas.width, field.canvas.height];
    fields.push({
      id: effect.id,
      expectedMs: estimateEffectBudget(effect.budget, size),
      size: [...size],
    });
  }
  return {
    milliseconds,
    expectedMs: fields.reduce((sum, f) => sum + f.expectedMs, 0),
    fields,
    undeclared,
  };
}
function scheduleCheck() {
  if (!enabled || timer !== undefined || !attachments.size) return;
  timer = setTimeout(() => {
    timer = undefined;
    const snapshot = pageBudgetSnapshot();
    const over = snapshot.expectedMs > milliseconds;
    if (over && !warned)
      console.warn('[hologpu] Visible animated fields exceed the declared page budget.', snapshot);
    warned = over;
    if (over) scheduleCheck();
  }, 100);
}
function syncMonitors() {
  if (enabled && attachments.size && !removePageListeners) {
    window.addEventListener('scroll', scheduleCheck, { passive: true });
    window.addEventListener('resize', scheduleCheck, { passive: true });
    document.addEventListener('visibilitychange', scheduleCheck);
    removePageListeners = () => {
      window.removeEventListener('scroll', scheduleCheck);
      window.removeEventListener('resize', scheduleCheck);
      document.removeEventListener('visibilitychange', scheduleCheck);
    };
  } else if ((!enabled || !attachments.size) && removePageListeners) {
    removePageListeners();
    removePageListeners = undefined;
  }
  for (const [attachment, remove] of attachments) {
    if (!enabled && remove) {
      remove();
      attachments.set(attachment, null);
    } else if (enabled && !remove) {
      const removeChange = attachment.field?.onChange(scheduleCheck);
      const removeRendered = attachment.field?.onRendered(scheduleCheck);
      const observer = new ResizeObserver(scheduleCheck);
      observer.observe(attachment.host);
      const intersection = new IntersectionObserver(scheduleCheck);
      intersection.observe(attachment.host);
      attachments.set(attachment, () => {
        removeChange?.();
        removeRendered?.();
        observer.disconnect();
        intersection.disconnect();
      });
    }
  }
  if ((!enabled || !attachments.size) && timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
    warned = false;
  }
}
/** Internal attachment lifecycle hook. Production retains only entries for explicit snapshots. */
export function trackPageBudget(attachment: BudgetAttachment): () => void {
  attachments.set(attachment, null);
  syncMonitors();
  scheduleCheck();
  return () => {
    attachments.get(attachment)?.();
    attachments.delete(attachment);
    syncMonitors();
    scheduleCheck();
  };
}
