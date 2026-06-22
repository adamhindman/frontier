import { describe, it, expect } from 'vitest';
import { getMoraleLabel, getWeightMultiplier, createStats } from './playerStats';

describe('getMoraleLabel', () => {
  it('returns Despair for 0', () => expect(getMoraleLabel(0)).toBe('Despair'));
  it('returns Despair for 20', () => expect(getMoraleLabel(20)).toBe('Despair'));
  it('returns Dejected for 21', () => expect(getMoraleLabel(21)).toBe('Dejected'));
  it('returns Dejected for 40', () => expect(getMoraleLabel(40)).toBe('Dejected'));
  it('returns Weary for 41', () => expect(getMoraleLabel(41)).toBe('Weary'));
  it('returns Weary for 60', () => expect(getMoraleLabel(60)).toBe('Weary'));
  it('returns Resolute for 61', () => expect(getMoraleLabel(61)).toBe('Resolute'));
  it('returns Resolute for 80', () => expect(getMoraleLabel(80)).toBe('Resolute'));
  it('returns Elated for 81', () => expect(getMoraleLabel(81)).toBe('Elated'));
  it('returns Elated for 100', () => expect(getMoraleLabel(100)).toBe('Elated'));
});

describe('getWeightMultiplier', () => {
  it('is 1.0 when carrying nothing', () => {
    const stats = createStats();
    stats.food = 0;
    stats.water = 0;
    expect(getWeightMultiplier(stats)).toBe(1.0);
  });

  it('decreases as weight increases', () => {
    const stats = createStats();
    stats.food = 20;
    stats.water = 6;
    // 26 lbs → 1 - 0.26 = 0.74
    expect(getWeightMultiplier(stats)).toBeCloseTo(0.74);
  });

  it('floors at 0.5', () => {
    const stats = createStats();
    stats.food = 100;
    stats.water = 100;
    expect(getWeightMultiplier(stats)).toBe(0.5);
  });
});
