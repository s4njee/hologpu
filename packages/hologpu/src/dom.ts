export * from '@mk7s/hologpu-dom';
import { registerHGPUField as register } from '@mk7s/hologpu-dom';
import type { EffectResolver } from '@mk7s/hologpu-dom';
import { loadEffect } from './effect-loaders.ts';
export { loadEffect };
export function registerHGPUField(options: { resolveEffect?: EffectResolver; name?: string } = {}) {
  return register({ ...options, resolveEffect: options.resolveEffect ?? loadEffect });
}
