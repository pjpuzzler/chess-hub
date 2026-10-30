import { describe, expect, it } from 'vitest';
import { displayName, surname } from './names';

describe('player names', () => {
  it('turns PGN "Last, First" into a natural full name', () => {
    expect(displayName('Fischer, Robert James')).toBe('Robert James Fischer');
    expect(displayName('Fischer, Robert J.')).toBe('Robert J. Fischer');
    expect(displayName('Spassky, Boris V.')).toBe('Boris V. Spassky');
    expect(displayName('Reti, R.')).toBe('R. Reti');
    expect(displayName('van Wely, Loek')).toBe('Loek van Wely');
    expect(displayName('Carlsen,Magnus')).toBe('Magnus Carlsen');
    expect(displayName(' Kasparov ,  Garry ')).toBe('Garry Kasparov');
  });
  it('leaves names without a comma alone', () => {
    expect(displayName('Garry Kasparov')).toBe('Garry Kasparov');
    expect(displayName('DrNykterstein')).toBe('DrNykterstein');
    expect(displayName('?')).toBe('?');
    expect(displayName('Fischer,')).toBe('Fischer');
  });
  it('gives the surname, never an initial', () => {
    expect(surname('Fischer, Robert James')).toBe('Fischer');
    expect(surname('Fischer, Robert J.')).toBe('Fischer');
    expect(surname('Spassky, Boris V.')).toBe('Spassky');
    expect(surname('van Wely, Loek')).toBe('van Wely');
    expect(surname('Richard Réti')).toBe('Réti');
    expect(surname('Garry Kasparov')).toBe('Kasparov');
    expect(surname('Robert J. Fischer')).toBe('Fischer');
    expect(surname('Alireza2003')).toBe('Alireza2003');
  });
});
