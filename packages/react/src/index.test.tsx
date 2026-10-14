// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HoloField } from './index.tsx';

const { attachMock, destroyMock } = vi.hoisted(() => ({
  attachMock: vi.fn(),
  destroyMock: vi.fn(),
}));

vi.mock('@mk7s/hologpu-dom', () => ({ attach: attachMock }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  attachMock.mockReset();
  destroyMock.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('attaches the effect on mount and disposes it on unmount', async () => {
  attachMock.mockResolvedValue({ destroy: destroyMock });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effect = { id: 'gradient-oklch' } as any;

  await act(async () => {
    root.render(
      <HoloField effect={effect}>
        <p>fallback</p>
      </HoloField>,
    );
  });

  expect(attachMock).toHaveBeenCalledTimes(1);
  expect(attachMock.mock.calls[0]?.[1]).toBe(effect);
  expect(container.querySelector('p')?.textContent).toBe('fallback');

  await act(async () => {
    root.unmount();
  });
  expect(destroyMock).toHaveBeenCalledTimes(1);
});

it('disposes an attachment that resolves after unmount', async () => {
  let resolveAttach: (value: { destroy: () => void }) => void = () => {};
  attachMock.mockReturnValue(
    new Promise((resolve) => {
      resolveAttach = resolve;
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const effect = { id: 'gradient-oklch' } as any;

  await act(async () => {
    root.render(<HoloField effect={effect} />);
  });
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    resolveAttach({ destroy: destroyMock });
  });

  expect(destroyMock).toHaveBeenCalledTimes(1);
});
