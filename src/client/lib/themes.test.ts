import { describe, expect, it } from 'vitest';
import { themeLabels } from './themes';

describe('themeLabels', () => {
  it('hides meta tags and labels tactics', () => {
    expect(
      themeLabels(['crushing', 'hangingPiece', 'long', 'middlegame'])
    ).toEqual(['Hanging piece']);
  });
  it('puts mate length first and drops the bare mate tag', () => {
    expect(themeLabels(['fork', 'mate', 'mateIn2', 'short'])).toEqual([
      'Mate in 2',
      'Fork',
    ]);
  });
  it('humanizes unknown themes', () => {
    expect(themeLabels(['someNewTheme'])).toEqual(['Some new theme']);
  });
});
