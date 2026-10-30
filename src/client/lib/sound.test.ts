import { describe, expect, it } from 'vitest';
import { soundForSan } from './sound';

describe('soundForSan', () => {
  it('picks the sound for a move', () => {
    expect(soundForSan('Nf3')).toBe('move');
    expect(soundForSan('Bxe5')).toBe('capture');
    expect(soundForSan('O-O-O')).toBe('move');
    expect(soundForSan('Qxf7#')).toBe('check');
    expect(soundForSan('Bb5+')).toBe('check');
  });
});
