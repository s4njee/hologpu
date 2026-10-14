import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { attach, type AttachOptions, type Attachment } from '@mk7s/hologpu-dom';
import type { EffectDefinition, ParamSchema } from '@mk7s/hologpu-core';

export interface HoloFieldProps<S extends ParamSchema = ParamSchema> extends AttachOptions {
  /** The effect definition to mount, e.g. `import gradient from '@mk7s/hologpu/effects/gradient-oklch'`. */
  effect: EffectDefinition<S>;
  className?: string;
  style?: CSSProperties;
  /** Authored light-DOM content, kept as the accessible fallback. */
  children?: ReactNode;
}

/**
 * A thin React wrapper over `attach`. It creates one host element, attaches the effect to it and
 * disposes the attachment on unmount, which is the most common integration mistake.
 */
export function HoloField<S extends ParamSchema = ParamSchema>({
  effect,
  className,
  style,
  children,
  ...options
}: HoloFieldProps<S>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let attachment: Attachment<S> | undefined;
    let cancelled = false;
    void attach(element, effect, options).then((attached) => {
      // The component may have unmounted (or the effect changed) before this resolved.
      if (cancelled) attached.destroy();
      else attachment = attached;
    });
    return () => {
      cancelled = true;
      attachment?.destroy();
    };
    // Re-attaching on every option change would thrash the GPU; options are read once per effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
