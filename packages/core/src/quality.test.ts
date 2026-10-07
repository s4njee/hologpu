import { it, expect } from 'vitest';
import { QualityController } from './quality.ts';
it('warms up, degrades work and resolution within bounds, and recovers with hysteresis', () => {
  const q = new QualityController(0.75, 0.25, 16);
  for (let i = 0; i < 30; i++) expect(q.observe(30)).toBeNull();
  expect(q.state).toEqual({ resolutionScale: 0.75, stepScale: 1 });
  for (let i = 0; i < 12; i++) q.observe(30);
  expect(q.state).toEqual({ resolutionScale: 0.75, stepScale: 0.5 });
  for (let i = 0; i < 500; i++) q.observe(30);
  expect(q.state).toEqual({ resolutionScale: 0.25, stepScale: 0.25 });
  for (let i = 0; i < 60; i++) q.observe(1);
  expect(q.state).toEqual({ resolutionScale: 0.25, stepScale: 0.25 });
  for (let i = 0; i < 1000; i++) q.observe(1);
  expect(q.state).toEqual({ resolutionScale: 0.75, stepScale: 1 });
  for (let i = 0; i < 1000; i++) q.observe(14);
  expect(q.state).toEqual({ resolutionScale: 0.75, stepScale: 1 });
});
it('ignores invalid samples and rejects invalid bounds', () => {
  const q = new QualityController();
  expect(q.observe(NaN)).toBeNull();
  expect(q.observe(-1)).toBeNull();
  expect(q.averageMs).toBe(0);
  expect(() => new QualityController(0.1, 0.25)).toThrow();
  expect(() => new QualityController(1, 0.25, 0)).toThrow();
});
it('responds to the first actual severe completion within bounds and retains cautious recovery', () => {
  const q = new QualityController(1, 0.25, 16);
  expect(q.observe(10000)).toEqual({ resolutionScale: 0.25, stepScale: 0.25 });
  expect(q.averageMs).toBe(10000);
  for (let i = 0; i < 149; i++) expect(q.observe(1)).toBeNull();
  expect(q.state).toEqual({ resolutionScale: 0.25, stepScale: 0.25 });
  expect(q.observe(1)).toEqual({ resolutionScale: 0.5, stepScale: 0.25 });
  const bounded = new QualityController(0.75, 0.5, 16);
  expect(bounded.observe(10000)).toEqual({ resolutionScale: 0.5, stepScale: 0.25 });
});
