import { describe, it, expect } from 'vitest';
import type { NoiseFunction2D } from 'simplex-noise';
import {
  createNoiseGenerators,
  sampleElevation,
  sampleMoisture,
  sampleRiver,
  sampleLake,
} from './noise';

const constant = (v: number): NoiseFunction2D => (() => v) as NoiseFunction2D;

describe('sampleElevation', () => {
  it('returns 1 when every octave saturates at +1', () => {
    expect(sampleElevation(10, 10, constant(1))).toBeCloseTo(1);
  });

  it('returns 0 when every octave saturates at -1', () => {
    expect(sampleElevation(10, 10, constant(-1))).toBeCloseTo(0);
  });

  it('returns 0.5 for a flat-zero noise function', () => {
    expect(sampleElevation(10, 10, constant(0))).toBeCloseTo(0.5);
  });
});

describe('sampleMoisture', () => {
  it('returns 1 when every octave saturates at +1', () => {
    expect(sampleMoisture(10, 10, constant(1))).toBeCloseTo(1);
  });

  it('returns 0 when every octave saturates at -1', () => {
    expect(sampleMoisture(10, 10, constant(-1))).toBeCloseTo(0);
  });

  it('returns 0.5 for a flat-zero noise function', () => {
    expect(sampleMoisture(10, 10, constant(0))).toBeCloseTo(0.5);
  });
});

describe('sampleRiver', () => {
  it('never returns a negative value', () => {
    expect(sampleRiver(10, 10, constant(-1))).toBeGreaterThanOrEqual(0);
    expect(sampleRiver(10, 10, constant(1))).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 when the underlying noise is flat zero', () => {
    expect(sampleRiver(10, 10, constant(0))).toBe(0);
  });

  it('returns 1 when the underlying noise saturates at +1 (abs of 1)', () => {
    expect(sampleRiver(10, 10, constant(1))).toBeCloseTo(1);
  });
});

describe('sampleLake', () => {
  it('returns 1 when every octave saturates at +1', () => {
    expect(sampleLake(10, 10, constant(1))).toBeCloseTo(1);
  });

  it('returns 0 when every octave saturates at -1', () => {
    expect(sampleLake(10, 10, constant(-1))).toBeCloseTo(0);
  });

  it('returns 0.5 for a flat-zero noise function', () => {
    expect(sampleLake(10, 10, constant(0))).toBeCloseTo(0.5);
  });
});

describe('createNoiseGenerators', () => {
  it('is deterministic: same seed produces identical sampled output', () => {
    const a = createNoiseGenerators('my-seed');
    const b = createNoiseGenerators('my-seed');
    expect(sampleElevation(123, 456, a.elevation)).toBe(sampleElevation(123, 456, b.elevation));
    expect(sampleMoisture(123, 456, a.moisture)).toBe(sampleMoisture(123, 456, b.moisture));
    expect(sampleRiver(123, 456, a.river)).toBe(sampleRiver(123, 456, b.river));
  });

  it('different seeds produce different elevation output', () => {
    const a = createNoiseGenerators('seed-one');
    const b = createNoiseGenerators('seed-two');
    expect(sampleElevation(123, 456, a.elevation)).not.toBe(sampleElevation(123, 456, b.elevation));
  });

  it('elevation, moisture, and river generators are independent even for the same seed', () => {
    const gens = createNoiseGenerators('shared-seed');
    const e = sampleElevation(50, 50, gens.elevation);
    const m = sampleMoisture(50, 50, gens.moisture);
    expect(e).not.toBe(m);
  });
});
