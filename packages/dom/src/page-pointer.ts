const subscribers = new Set<(position: readonly [number, number]) => void>();
let position: readonly [number, number] | undefined;
const move = (event: PointerEvent) => {
  position = [event.clientX, event.clientY];
  for (const listener of subscribers) listener(position);
};
/** One document listener shared by every attached page spotlight. */
export function subscribePagePointer(listener: (position: readonly [number, number]) => void) {
  if (!subscribers.size) document.addEventListener('pointermove', move, { passive: true });
  subscribers.add(listener);
  listener(position ?? [innerWidth / 2, innerHeight / 2]);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) {
      document.removeEventListener('pointermove', move);
      position = undefined;
    }
  };
}
