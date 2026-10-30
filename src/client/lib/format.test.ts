import { describe, expect, it } from 'vitest';
import {
  duration,
  durationShort,
  sharePercents,
  timeControlLabel,
} from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(duration(7 * 3_600_000 + 12 * 60_000)).toBe('7h 12m');
    expect(duration(30_000)).toBe('1m');
    expect(duration(3 * 3_600_000)).toBe('3h');
    expect(duration(72 * 3_600_000)).toBe('3d');
    expect(durationShort(7 * 3_600_000 + 50 * 60_000)).toBe('7h');
  });
  it('makes shares sum to 100', () => {
    expect(sharePercents([412, 133, 61, 29])).toEqual([65, 21, 10, 4]);
    expect(sharePercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharePercents([0, 0])).toEqual([0, 0]);
    const p = sharePercents([7, 5, 3, 2, 1]);
    expect(p.reduce((a, b) => a + b, 0)).toBe(100);
  });
  it('labels time controls', () => {
    expect(timeControlLabel('600+0')).toBe('10+0 Rapid');
    expect(timeControlLabel('180+2')).toBe('3+2 Blitz');
    expect(timeControlLabel('60+0')).toBe('1+0 Bullet');
    expect(timeControlLabel('90+0')).toBe('1.5+0 Bullet');
  });
});
